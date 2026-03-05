import type { BlitzAction, BlitzRun } from "@trd-aiblitz/domain";
import { GbpApiClient, refreshAccessToken } from "@trd-aiblitz/integrations-gbp";
import QRCode from "qrcode";
import sharp from "sharp";
import { decryptJsonToken, encryptJsonToken } from "../crypto";
import { getSupabaseServiceClient, isSupabaseConfigured } from "../supabase";
import type {
  ActionExecutionResult,
  ActionExecutor,
  BlitzRunRepository,
  ClientMediaAssetRecord,
  ClientOrchestrationSettingsRecord,
  IntegrationConnectionRecord
} from "../types";

interface TokenPayload {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

interface ResolvedLocation {
  accountName: string;
  accountId: string;
  locationName: string;
  locationId: string;
  title: string | null;
  websiteUri: string | null;
}

interface RunContext {
  connection: IntegrationConnectionRecord;
  token: TokenPayload;
  client: GbpApiClient;
  locations: ResolvedLocation[];
  warnings: string[];
  settings: ClientOrchestrationSettingsRecord;
  mediaAssets: ClientMediaAssetRecord[];
}

interface LandingPageContext {
  pageTitle: string | null;
  metaDescription: string | null;
  h1: string | null;
  firstParagraph: string | null;
}

interface TinyUrlResult {
  tinyUrl: string;
  originalUrl: string;
  success: boolean;
  error?: string;
}

interface ExecutorOptions {
  maxPostBurst: number;
  maxReviewRepliesPerAction: number;
}

const DEFAULT_OPTIONS: ExecutorOptions = {
  maxPostBurst: 25,
  maxReviewRepliesPerAction: 60
};

function nowIso(): string {
  return new Date().toISOString();
}

function toNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(String).map((entry) => entry.trim()).filter(Boolean);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function parseAccountId(accountName: string): string {
  return accountName.replace(/^accounts\//, "");
}

function parseLocationId(locationName: string): string {
  return locationName.replace(/^locations\//, "");
}

function parseReviewId(reviewName: string, fallback?: string): string {
  const match = reviewName.match(/reviews\/([^/]+)$/);
  return match?.[1] ?? fallback ?? reviewName;
}

function parseLocalPostReference(postName: string): { accountId: string; locationId: string; localPostId: string } | null {
  const match = postName.match(/accounts\/([^/]+)\/locations\/([^/]+)\/localPosts\/([^/]+)$/);
  if (!match) {
    return null;
  }
  return {
    accountId: match[1],
    locationId: match[2],
    localPostId: match[3]
  };
}

function parseStarRating(value: unknown): number {
  if (typeof value === "number") {
    return Math.max(0, Math.min(5, Math.floor(value)));
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return Math.max(0, Math.min(5, Math.floor(numeric)));
    }

    const enumMap: Record<string, number> = {
      FIVE: 5,
      FOUR: 4,
      THREE: 3,
      TWO: 2,
      ONE: 1
    };
    return enumMap[value.toUpperCase()] ?? 0;
  }
  return 0;
}

function wordCount(value: string): number {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function truncateToMaxWords(value: string, maxWords: number): string {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) {
    return value.trim();
  }
  const trimmed = words.slice(0, maxWords).join(" ").trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function readableObjective(objective: string): string {
  return objective
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function extractSitemapLocEntries(xml: string): string[] {
  const matches = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)];
  return matches
    .map((match) => decodeXmlEntities(match[1] ?? "").trim())
    .filter((entry) => entry.startsWith("http://") || entry.startsWith("https://"));
}

function likelyNestedSitemap(url: string): boolean {
  const normalized = url.toLowerCase();
  return normalized.endsWith(".xml") || normalized.includes("sitemap");
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripHtmlTags(value: string): string {
  return normalizeText(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );
}

function extractHtmlTagContent(html: string, tagName: string): string | null {
  const match = html.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  if (!match?.[1]) {
    return null;
  }
  return stripHtmlTags(match[1]).slice(0, 220) || null;
}

function extractMetaDescription(html: string): string | null {
  const match =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["'][^>]*>/i);
  if (!match?.[1]) {
    return null;
  }
  return normalizeText(decodeXmlEntities(match[1])).slice(0, 260) || null;
}

function toSentenceCase(value: string): string {
  if (!value) {
    return value;
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function summarizeUrlPath(urlString: string): string {
  try {
    const url = new URL(urlString);
    const path = url.pathname.replace(/^\/+|\/+$/g, "");
    if (!path) {
      return "homepage offers";
    }
    const tokens = path
      .split("/")
      .flatMap((segment) => segment.split("-"))
      .map((token) => token.trim())
      .filter(Boolean)
      .slice(0, 6);
    if (!tokens.length) {
      return "service content";
    }
    return `${tokens.join(" ")} information`;
  } catch {
    return "service information";
  }
}

function sanitizeStorageSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function normalizeHttpUrl(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  try {
    const normalized = new URL(value.trim());
    if (normalized.protocol !== "http:" && normalized.protocol !== "https:") {
      return null;
    }
    return normalized.toString();
  } catch {
    return null;
  }
}

function hashStringToNumber(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function mediaUrlFromAsset(asset: ClientMediaAssetRecord): string | null {
  const metadata = asRecord(asset.metadata);
  const candidates = [
    typeof metadata.signedUrl === "string" ? metadata.signedUrl : null,
    typeof metadata.publicUrl === "string" ? metadata.publicUrl : null,
    typeof metadata.sourceUrl === "string" ? metadata.sourceUrl : null,
    typeof metadata.url === "string" ? metadata.url : null
  ].filter((value): value is string => Boolean(value));
  return candidates[0] ?? null;
}

function buildEeatLongFormPost(input: {
  locationTitle: string;
  objective: string;
  ordinal: number;
  tone: string;
  wordRange: { min: number; max: number };
  landingUrl: string;
  shortUrl: string;
  pageContext: LandingPageContext;
  ctaUrl?: string | null;
}): { longForm: string; snippet: string } {
  const targetMin = clamp(input.wordRange.min, 120, 2000);
  const targetMax = clamp(Math.max(targetMin, input.wordRange.max), targetMin, 2000);
  const targetWords = clamp(Math.round((targetMin + targetMax) / 2), targetMin, targetMax);
  const objectiveLabel = readableObjective(input.objective);
  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const topicLabel =
    input.pageContext.h1 ??
    input.pageContext.pageTitle ??
    toSentenceCase(summarizeUrlPath(input.landingUrl));
  const metaBlurb =
    input.pageContext.metaDescription ??
    input.pageContext.firstParagraph ??
    `${input.locationTitle} updated this page to answer high-intent local buyer questions with clearer scope, proof, and CTA guidance.`;
  const ctaTarget = input.ctaUrl ?? input.shortUrl;

  const requiredSections = [
    `# Local Service Brief (${today})`,
    "## Experience",
    `${input.locationTitle} completed this week's ${objectiveLabel} cycle and aligned this GBP post to the live page topic: "${topicLabel}". This update uses a ${input.tone} tone so local buyers can quickly evaluate fit, timelines, and practical outcomes before contacting the team.`,
    "## Expertise",
    `The team standardized delivery checkpoints for discovery, planning, execution, and handoff. Each checkpoint includes operating detail, expected turnaround, quality controls, and escalation rules so service quality stays consistent even as request volume changes. Core page focus: ${metaBlurb}`,
    "## Authoritativeness",
    `This location benchmarked active local competitors, category intent, and profile visibility factors. Published facts focus on verifiable service details, clear scope boundaries, and location relevance so search systems can classify the business accurately for high-intent queries.`,
    "## Trust",
    `Claims in this post are tied to real operations, documented customer interactions, and current availability. Messaging avoids inflated promises and keeps language specific enough for users to validate through direct contact, review history, and current profile metadata. Traffic path tracked via ${ctaTarget}.`,
    "## Structured Snippet",
    "- Service Availability: verified for current schedule windows\n- Location Relevance: aligned with local intent clusters\n- Operational Proof: process checkpoints and response SLAs documented\n- Reputation Signals: review response workflow active with escalation guardrails",
    "## Action Summary",
    `This is entry #${input.ordinal} in the current Blitz content sequence. The post captures EEAT-aligned proof points, practical delivery detail, and next-step guidance for local search users evaluating providers right now.`
  ];

  const supplementalParagraphs = [
    `${input.locationTitle} also documented common pre-service questions so potential customers can compare options before requesting work. This includes expected prep steps, required customer inputs, and realistic completion windows tied to service type.`,
    `Internal QA now logs completion standards for every published service update, including factual accuracy checks, local relevance checks, and final compliance review before content is pushed live. This protects consistency across profile, website, and ad messaging.`,
    `Customer communication standards were refreshed to include clearer status updates during active jobs, faster follow-up after delivery, and transparent escalation paths when service issues appear. These operating changes are designed to improve trust and repeat engagement signals.`,
    `The profile content strategy now emphasizes concise, intent-matched language that maps directly to service outcomes customers care about: turnaround speed, scope clarity, and reliability. That keeps the listing useful for both users and AI-driven local discovery systems.`,
    `Performance tracking remains active across calls, direction requests, profile clicks, and review patterns. The team uses these signals to tune the next publishing cycle and keep future updates grounded in what local users are actually doing.`,
    `Media and post cadence controls are synchronized with policy limits so activity remains natural and sustainable over time. This prevents inconsistent burst behavior while still maintaining freshness signals that influence local visibility.`,
    `Operational details, service constraints, and fulfillment windows are reviewed weekly to ensure published information stays current. If delivery constraints change, the content plan is updated immediately to avoid stale or misleading statements.`
  ];

  let longForm = requiredSections.join("\n\n");
  let paragraphIndex = 0;
  while (wordCount(longForm) < targetWords) {
    const paragraph = supplementalParagraphs[paragraphIndex % supplementalParagraphs.length];
    longForm = `${longForm}\n\n${paragraph}`;
    paragraphIndex += 1;
  }

  if (wordCount(longForm) > targetMax) {
    longForm = truncateToMaxWords(longForm, targetMax);
  }

  if (input.ctaUrl) {
    longForm = `${longForm}\n\n## Next Step\nRead more or request service: ${input.ctaUrl}`;
    if (wordCount(longForm) > targetMax) {
      longForm = truncateToMaxWords(longForm, targetMax);
    }
  }

  const summaryHeader = `${input.locationTitle} local update:`;
  const snippetRaw = `${summaryHeader} ${topicLabel} was refreshed with EEAT-aligned service proof, local buyer guidance, and direct conversion intent. ${metaBlurb} Learn more: ${ctaTarget}`.trim();
  const snippet = snippetRaw.slice(0, 1450);

  return {
    longForm,
    snippet
  };
}

function replyForReview(input: {
  reviewerName: string;
  starRating: number;
  comment: string;
  locationTitle: string;
  tone: string;
  style: string;
}): string {
  const name = input.reviewerName.trim() || "there";
  const intro = `Hi ${name}, thank you for your feedback.`;
  const tonePrefix = input.tone.includes("friendly") ? "We appreciate you choosing us." : "";
  if (input.starRating >= 4) {
    return `${intro} ${tonePrefix} We appreciate your ${input.starRating}-star review for ${input.locationTitle}. We look forward to serving you again soon.`.replace(/\s+/g, " ").trim();
  }
  if (input.starRating === 3) {
    return `${intro} ${tonePrefix} We appreciate you choosing ${input.locationTitle} and will use your feedback to keep improving.`.replace(/\s+/g, " ").trim();
  }
  const directEnding = input.style.toLowerCase().includes("direct")
    ? "Please contact our team today so we can fix this immediately."
    : "Please contact our team so we can make this right.";
  return `${intro} We're sorry your experience at ${input.locationTitle} did not meet expectations. ${directEnding}`.replace(/\s+/g, " ").trim();
}

function buildPostSummary(input: {
  locationTitle: string;
  objective: string;
  ordinal: number;
  payload: Record<string, unknown>;
}): string {
  const explicit = typeof input.payload.summaryTemplate === "string" ? input.payload.summaryTemplate.trim() : "";
  if (explicit) {
    return explicit.slice(0, 1500);
  }

  const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const prefix = input.objective === "geo_content_burst" ? "Local Update" : "Business Update";
  return `${prefix}: ${input.locationTitle} is actively serving local customers. Reach out today for fast support and availability (${today}, #${input.ordinal}).`.slice(
    0,
    1500
  );
}

export class GbpLiveActionExecutor implements ActionExecutor {
  private readonly contextCache = new Map<string, RunContext>();
  private readonly options: ExecutorOptions;

  constructor(
    private readonly deps: {
      repository: BlitzRunRepository;
    },
    options?: Partial<ExecutorOptions>
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async execute(input: { run: BlitzRun; action: BlitzAction }): Promise<ActionExecutionResult> {
    const context = await this.loadRunContext(input.run, input.action);
    const objective = typeof input.action.payload.objective === "string" ? input.action.payload.objective : "unknown";

    switch (input.action.actionType) {
      case "profile_patch":
        return {
          output: await this.executeProfilePatch({ action: input.action, context, objective })
        };
      case "attribute_update":
        return {
          output: await this.executeAttributeUpdate({ action: input.action, context })
        };
      case "media_upload":
        return {
          output: await this.executeMediaUpload({ context })
        };
      case "post_publish":
        return {
          output: await this.executePostPublish({ action: input.action, context, objective })
        };
      case "review_reply":
        return {
          output: await this.executeReviewReplies({ action: input.action, context })
        };
      case "hours_update":
        return {
          output: await this.executeHoursUpdate({ action: input.action, context })
        };
      default:
        throw new Error(`Unsupported action type: ${input.action.actionType}`);
    }
  }

  async rollback(input: { run: BlitzRun; action: BlitzAction }): Promise<{ output: Record<string, unknown> }> {
    const context = await this.loadRunContext(input.run, input.action);

    if (input.action.actionType !== "post_publish") {
      return {
        output: {
          status: "rollback_not_supported",
          actionType: input.action.actionType
        }
      };
    }

    const publishedPosts = Array.isArray(input.action.result?.publishedPosts)
      ? (input.action.result?.publishedPosts as Array<Record<string, unknown>>)
      : [];

    const deleted: Array<Record<string, unknown>> = [];
    const failed: Array<Record<string, unknown>> = [];

    for (const entry of publishedPosts) {
      const postName = typeof entry.name === "string" ? entry.name : "";
      const parsed = parseLocalPostReference(postName);
      if (!parsed) {
        failed.push({
          name: postName || "unknown",
          error: "invalid post name format"
        });
        continue;
      }

      try {
        await context.client.deleteLocalPost(parsed.accountId, parsed.locationId, parsed.localPostId);
        deleted.push({
          name: postName,
          accountId: parsed.accountId,
          locationId: parsed.locationId
        });
      } catch (error) {
        failed.push({
          name: postName,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return {
      output: {
        status: failed.length ? "partial" : "ok",
        deletedPosts: deleted,
        failedPosts: failed
      }
    };
  }

  private async loadRunContext(run: BlitzRun, action: BlitzAction): Promise<RunContext> {
    const cached = this.contextCache.get(run.id);
    if (cached && !this.isTokenExpiring(cached.token, 900)) {
      return cached;
    }

    const connection = await this.deps.repository.getActiveIntegrationConnection(run.clientId, "gbp");
    if (!connection) {
      throw new Error(
        `No active GBP integration found for client ${run.clientId}. Connect GBP OAuth before starting a live run.`
      );
    }

    const token = await this.ensureFreshToken(connection);
    const client = new GbpApiClient(token.accessToken);
    const resolved = await this.resolveLocations(connection, client, action.payload);

    if (!resolved.locations.length) {
      throw new Error("No GBP locations found for the connected account scope.");
    }

    const settings = await this.deps.repository.getClientOrchestrationSettings(run.clientId);
    const mediaAssets = await this.deps.repository.listClientMediaAssets(run.clientId);

    const context: RunContext = {
      connection,
      token,
      client,
      locations: resolved.locations,
      warnings: resolved.warnings,
      settings,
      mediaAssets
    };

    this.contextCache.set(run.id, context);
    return context;
  }

  private async ensureFreshToken(connection: IntegrationConnectionRecord): Promise<TokenPayload> {
    const tokenBlob = connection.encryptedTokenPayload.token;
    if (typeof tokenBlob !== "string" || !tokenBlob.length) {
      throw new Error("GBP integration token payload is missing encrypted token blob.");
    }

    const decrypted = decryptJsonToken(tokenBlob);
    const accessToken = typeof decrypted.accessToken === "string" ? decrypted.accessToken : "";
    const refreshToken = typeof decrypted.refreshToken === "string" ? decrypted.refreshToken : "";
    const expiresAt = typeof decrypted.expiresAt === "string" ? decrypted.expiresAt : null;

    if (!accessToken) {
      throw new Error("GBP integration token payload is missing access token.");
    }

    const hasExpiry = typeof expiresAt === "string" && !Number.isNaN(new Date(expiresAt).getTime());
    const expiringSoon = hasExpiry ? this.isTokenExpiring({ accessToken, refreshToken, expiresAt }, 120) : false;
    if (!expiringSoon) {
      return {
        accessToken,
        refreshToken,
        expiresAt: hasExpiry ? expiresAt : new Date(Date.now() + 45 * 60 * 1000).toISOString()
      };
    }

    if (!refreshToken) {
      throw new Error("GBP access token is expiring and refresh token is not available.");
    }

    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
    const redirectUri =
      process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() ??
      process.env.NEXT_PUBLIC_SITE_URL?.trim()?.concat("/api/v1/gbp/oauth/callback") ??
      "https://localhost/api/v1/gbp/oauth/callback";
    if (!clientId || !clientSecret) {
      throw new Error("Google OAuth env missing. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET.");
    }

    const refreshed = await refreshAccessToken(
      {
        clientId,
        clientSecret,
        redirectUri
      },
      refreshToken
    );

    const nextToken: TokenPayload = {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      expiresAt: refreshed.expiresAt
    };

    await this.deps.repository.updateIntegrationConnection(connection.id, {
      encryptedTokenPayload: {
        ...connection.encryptedTokenPayload,
        token: encryptJsonToken({
          accessToken: nextToken.accessToken,
          refreshToken: nextToken.refreshToken,
          expiresAt: nextToken.expiresAt
        })
      },
      scopes: refreshed.scopes.length ? refreshed.scopes : connection.scopes,
      tokenExpiresAt: refreshed.expiresAt,
      lastRefreshAt: nowIso()
    });

    return nextToken;
  }

  private async resolveLocations(
    connection: IntegrationConnectionRecord,
    client: GbpApiClient,
    actionPayload: Record<string, unknown>
  ): Promise<{ locations: ResolvedLocation[]; warnings: string[] }> {
    const warnings: string[] = [];
    const accounts = await client.listAccounts();

    if (!accounts.length) {
      throw new Error("Connected GBP user has no accessible accounts.");
    }

    const accountNames = accounts.map((account) => account.name).filter(Boolean);
    const metadata = asRecord(connection.metadata);
    const payloadRequestedAccount = typeof actionPayload.accountName === "string" ? actionPayload.accountName : null;

    const candidates = [
      payloadRequestedAccount,
      connection.providerAccountId.startsWith("accounts/") ? connection.providerAccountId : null,
      typeof metadata.accountName === "string" ? metadata.accountName : null
    ].filter((value): value is string => Boolean(value));

    let scopedAccounts = [...new Set(candidates)].filter((candidate) => accountNames.includes(candidate));
    if (!scopedAccounts.length) {
      if (accounts.length === 1) {
        scopedAccounts = [accounts[0].name];
      } else {
        scopedAccounts = [accounts[0].name];
        warnings.push(
          `No explicit account scope configured; defaulted to ${accounts[0].name}. Configure providerAccountId/accountName for strict targeting.`
        );
      }
    }

    const locations: ResolvedLocation[] = [];
    for (const accountName of scopedAccounts) {
      const accountId = parseAccountId(accountName);
      const locationRows = await client.listLocations(accountName);
      for (const row of locationRows) {
        if (!row.name) {
          continue;
        }
        locations.push({
          accountName,
          accountId,
          locationName: row.name,
          locationId: parseLocationId(row.name),
          title: row.title ?? null,
          websiteUri: row.websiteUri ?? null
        });
      }
    }

    const payloadLocationNames = toStringArray(actionPayload.locationNames);
    const metadataLocationNames = [
      ...(typeof metadata.locationName === "string" ? [metadata.locationName] : []),
      ...toStringArray(metadata.locationNames)
    ];
    const filteredLocations =
      payloadLocationNames.length > 0
        ? locations.filter((location) => payloadLocationNames.includes(location.locationName))
        : metadataLocationNames.length > 0
          ? locations.filter((location) => metadataLocationNames.includes(location.locationName))
          : locations;

    return {
      locations: filteredLocations,
      warnings
    };
  }

  private async fetchTextWithTimeout(url: string, timeoutMs = 15000): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: "text/html,application/xml;q=0.9,text/xml;q=0.9,*/*;q=0.5"
        }
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }
      return await response.text();
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchBufferWithTimeout(url: string, timeoutMs = 15000): Promise<Buffer> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }
      return Buffer.from(await response.arrayBuffer());
    } finally {
      clearTimeout(timer);
    }
  }

  private async loadSitemapUrls(sitemapUrl: string | null): Promise<string[]> {
    const normalizedSitemapUrl = normalizeHttpUrl(sitemapUrl);
    if (!normalizedSitemapUrl) {
      return [];
    }

    const visited = new Set<string>();
    const primaryHost = new URL(normalizedSitemapUrl).host;

    const walk = async (url: string, depth: number): Promise<string[]> => {
      if (depth > 2 || visited.has(url)) {
        return [];
      }
      visited.add(url);

      let xml: string;
      try {
        xml = await this.fetchTextWithTimeout(url, 15000);
      } catch {
        return [];
      }

      const entries = extractSitemapLocEntries(xml);
      if (!entries.length) {
        return [];
      }

      const nested = entries.filter(likelyNestedSitemap).slice(0, 12);
      const pages = entries.filter((entry) => !likelyNestedSitemap(entry));
      if (!nested.length || depth >= 2) {
        return pages;
      }

      const nestedPages = (
        await Promise.all(nested.map(async (nestedUrl) => walk(nestedUrl, depth + 1)))
      ).flat();

      return [...pages, ...nestedPages];
    };

    const rawUrls = await walk(normalizedSitemapUrl, 0);
    const filtered = [...new Set(rawUrls)]
      .map((entry) => normalizeHttpUrl(entry))
      .filter((entry): entry is string => Boolean(entry))
      .filter((entry) => {
        try {
          const parsed = new URL(entry);
          if (parsed.host !== primaryHost) {
            return false;
          }
          const lowerPath = `${parsed.pathname}${parsed.search}`.toLowerCase();
          if (
            lowerPath.includes("/tag/") ||
            lowerPath.includes("/author/") ||
            lowerPath.includes("/feed") ||
            lowerPath.includes("/wp-json") ||
            lowerPath.includes("/category/")
          ) {
            return false;
          }
          return true;
        } catch {
          return false;
        }
      });

    return filtered;
  }

  private selectLandingUrl(input: {
    action: BlitzAction;
    context: RunContext;
    location: ResolvedLocation;
    index: number;
    sitemapUrls: string[];
  }): { landingUrl: string; source: "payload" | "sitemap" | "default" } {
    const payloadLandingUrl = normalizeHttpUrl(
      typeof input.action.payload.landingUrl === "string" ? input.action.payload.landingUrl : null
    );
    if (payloadLandingUrl) {
      return {
        landingUrl: payloadLandingUrl,
        source: "payload"
      };
    }

    if (input.sitemapUrls.length > 0) {
      const seed = hashStringToNumber(`${input.action.id}:${input.location.locationId}:${input.index}`);
      const selected = input.sitemapUrls[seed % input.sitemapUrls.length];
      return {
        landingUrl: selected,
        source: "sitemap"
      };
    }

    const fallback =
      normalizeHttpUrl(input.context.settings.defaultPostUrl) ??
      normalizeHttpUrl(input.location.websiteUri);
    if (!fallback) {
      throw new Error("No valid landing URL found. Configure sitemapUrl or defaultPostUrl for this client.");
    }
    return {
      landingUrl: fallback,
      source: "default"
    };
  }

  private async fetchLandingPageContext(url: string): Promise<LandingPageContext> {
    try {
      const html = await this.fetchTextWithTimeout(url, 12000);
      const paragraphMatch = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
      return {
        pageTitle: extractHtmlTagContent(html, "title"),
        metaDescription: extractMetaDescription(html),
        h1: extractHtmlTagContent(html, "h1"),
        firstParagraph: paragraphMatch?.[1] ? stripHtmlTags(paragraphMatch[1]).slice(0, 320) : null
      };
    } catch {
      return {
        pageTitle: null,
        metaDescription: null,
        h1: null,
        firstParagraph: null
      };
    }
  }

  private async createTinyUrl(url: string): Promise<TinyUrlResult> {
    const normalized = normalizeHttpUrl(url);
    if (!normalized) {
      return {
        tinyUrl: url,
        originalUrl: url,
        success: false,
        error: "Invalid URL for TinyURL"
      };
    }

    const apiKey = process.env.TINYURL_API_KEY?.trim();
    if (!apiKey) {
      return {
        tinyUrl: normalized,
        originalUrl: normalized,
        success: false,
        error: "TINYURL_API_KEY not configured"
      };
    }

    try {
      const response = await fetch("https://api.tinyurl.com/create", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          url: normalized
        })
      });

      if (!response.ok) {
        return {
          tinyUrl: normalized,
          originalUrl: normalized,
          success: false,
          error: `TinyURL API returned ${response.status}`
        };
      }

      const payload = (await response.json()) as { data?: { tiny_url?: string } };
      const tinyUrl = normalizeHttpUrl(payload.data?.tiny_url ?? null);
      if (!tinyUrl) {
        return {
          tinyUrl: normalized,
          originalUrl: normalized,
          success: false,
          error: "TinyURL response missing tiny_url"
        };
      }

      return {
        tinyUrl,
        originalUrl: normalized,
        success: true
      };
    } catch (error) {
      return {
        tinyUrl: normalized,
        originalUrl: normalized,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async resolveDirectAssetMediaUrl(asset: ClientMediaAssetRecord): Promise<string | null> {
    const existing = normalizeHttpUrl(mediaUrlFromAsset(asset));
    if (existing) {
      return existing;
    }

    if (!isSupabaseConfigured()) {
      return null;
    }

    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase.storage.from(asset.storageBucket).createSignedUrl(asset.storagePath, 60 * 60 * 24 * 7);
    if (error || !data?.signedUrl) {
      return null;
    }
    return normalizeHttpUrl(data.signedUrl);
  }

  private async downloadAssetBuffer(asset: ClientMediaAssetRecord): Promise<Buffer> {
    if (isSupabaseConfigured()) {
      const supabase = getSupabaseServiceClient();
      const { data, error } = await supabase.storage.from(asset.storageBucket).download(asset.storagePath);
      if (!error && data) {
        return Buffer.from(await data.arrayBuffer());
      }
    }

    const directUrl = await this.resolveDirectAssetMediaUrl(asset);
    if (!directUrl) {
      throw new Error(`Unable to resolve downloadable URL for media asset ${asset.id}`);
    }
    return this.fetchBufferWithTimeout(directUrl, 15000);
  }

  private async generateQrOverlayMedia(input: {
    asset: ClientMediaAssetRecord;
    clientId: string;
    actionId: string;
    qrUrl: string;
  }): Promise<{ mediaUrl: string | null; processedStoragePath: string | null; error: string | null }> {
    const fallbackMediaUrl = await this.resolveDirectAssetMediaUrl(input.asset);
    if (!isSupabaseConfigured()) {
      return {
        mediaUrl: fallbackMediaUrl,
        processedStoragePath: null,
        error: "Supabase is not configured for QR media generation"
      };
    }

    const supabase = getSupabaseServiceClient();

    try {
      const sourceBuffer = await this.downloadAssetBuffer(input.asset);
      const image = sharp(sourceBuffer, { failOn: "none" });
      const metadata = await image.metadata();
      const width = metadata.width ?? 0;
      const height = metadata.height ?? 0;
      if (width < 100 || height < 100) {
        throw new Error("Source image dimensions are too small for QR overlay");
      }

      const qrSize = Math.floor(clamp(Math.min(width, height) * 0.16, 100, 420));
      const padding = Math.floor(clamp(Math.min(width, height) * 0.025, 10, 40));
      const qrBuffer = await QRCode.toBuffer(input.qrUrl, {
        width: qrSize,
        margin: 1,
        color: {
          dark: "#000000",
          light: "#FFFFFF"
        }
      });

      const backgroundSize = qrSize + padding * 2;
      const qrWithBackground = await sharp({
        create: {
          width: backgroundSize,
          height: backgroundSize,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 0.9 }
        }
      })
        .composite([
          {
            input: qrBuffer,
            left: padding,
            top: padding
          }
        ])
        .png()
        .toBuffer();

      const left = Math.max(0, width - backgroundSize - padding);
      const top = Math.max(0, height - backgroundSize - padding);

      const outputBuffer = await image
        .png()
        .composite([
          {
            input: qrWithBackground,
            left,
            top
          }
        ])
        .png()
        .toBuffer();

      const dateFolder = new Date().toISOString().slice(0, 10);
      const outputPath = `processed/${dateFolder}/${sanitizeStorageSegment(input.clientId)}-${sanitizeStorageSegment(input.actionId)}-${sanitizeStorageSegment(input.asset.id)}-${Date.now()}.png`;

      const { error: uploadError } = await supabase.storage.from(input.asset.storageBucket).upload(outputPath, outputBuffer, {
        contentType: "image/png",
        cacheControl: "3600",
        upsert: false
      });
      if (uploadError) {
        throw new Error(uploadError.message);
      }

      const { data: signedData, error: signedError } = await supabase.storage
        .from(input.asset.storageBucket)
        .createSignedUrl(outputPath, 60 * 60 * 24 * 7);
      if (signedError || !signedData?.signedUrl) {
        throw new Error(signedError?.message ?? "Unable to create signed URL for processed image");
      }

      return {
        mediaUrl: normalizeHttpUrl(signedData.signedUrl),
        processedStoragePath: outputPath,
        error: null
      };
    } catch (error) {
      return {
        mediaUrl: fallbackMediaUrl,
        processedStoragePath: null,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async executeProfilePatch(input: {
    action: BlitzAction;
    context: RunContext;
    objective: string;
  }): Promise<Record<string, unknown>> {
    const patchPayload = asRecord(input.action.payload.patch);
    const updateMask = toStringArray(input.action.payload.updateMask);

    if (Object.keys(patchPayload).length > 0 && updateMask.length > 0) {
      const patched: Array<Record<string, unknown>> = [];
      const failed: Array<Record<string, unknown>> = [];
      for (const location of input.context.locations) {
        try {
          await input.context.client.patchLocation(location.locationName, patchPayload, updateMask);
          patched.push({
            locationName: location.locationName,
            title: location.title
          });
        } catch (error) {
          failed.push({
            locationName: location.locationName,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      if (!patched.length) {
        throw new Error(`Profile patch failed for all scoped locations: ${failed[0]?.error ?? "unknown error"}`);
      }

      return {
        objective: input.objective,
        patchedLocations: patched,
        failedLocations: failed,
        warnings: input.context.warnings
      };
    }

    const checks = await Promise.all(
      input.context.locations.slice(0, 10).map(async (location) => {
        const detail = await input.context.client.fetchLocation(location.locationName);
        return {
          accountId: location.accountId,
          locationName: location.locationName,
          title: detail?.title ?? location.title,
          hasCategories: Array.isArray(detail?.categories) && detail.categories.length > 0,
          hasHours: Boolean(detail?.regularHours),
          hasAttributes: Array.isArray(detail?.attributes) && detail.attributes.length > 0,
          hasProfileDescription: Boolean(asRecord(detail?.profile).description)
        };
      })
    );

    return {
      objective: input.objective,
      mode: "read_only_snapshot",
      accountCount: [...new Set(input.context.locations.map((location) => location.accountId))].length,
      locationCount: input.context.locations.length,
      checkedLocations: checks,
      warnings: input.context.warnings
    };
  }

  private async executeAttributeUpdate(input: {
    action: BlitzAction;
    context: RunContext;
  }): Promise<Record<string, unknown>> {
    const matrix = await Promise.all(
      input.context.locations.map(async (location) => {
        const detail = await input.context.client.fetchLocation(location.locationName);
        const profile = asRecord(detail?.profile);
        const missing: string[] = [];
        if (!(Array.isArray(detail?.categories) && detail.categories.length > 0)) {
          missing.push("categories");
        }
        if (!detail?.regularHours) {
          missing.push("regularHours");
        }
        if (!(Array.isArray(detail?.attributes) && detail.attributes.length > 0)) {
          missing.push("attributes");
        }
        if (!profile.description) {
          missing.push("profile.description");
        }
        if (!detail?.websiteUri) {
          missing.push("websiteUri");
        }

        return {
          accountId: location.accountId,
          locationName: location.locationName,
          title: detail?.title ?? location.title,
          missing
        };
      })
    );

    return {
      objective: input.action.payload.objective ?? "completeness_gap_matrix",
      locationsAnalyzed: matrix.length,
      gapMatrix: matrix
    };
  }

  private async executeMediaUpload(input: { context: RunContext }): Promise<Record<string, unknown>> {
    return {
      objective: "media_derivative_batch_upload",
      uploaded: 0,
      status: "no_media_assets_supplied",
      guidance: "Provide approved media asset URLs in action payload to activate live media uploads.",
      locationCount: input.context.locations.length
    };
  }

  private async executePostPublish(input: {
    action: BlitzAction;
    context: RunContext;
    objective: string;
  }): Promise<Record<string, unknown>> {
    if (input.objective === "schedule_follow_up_posts") {
      const cadence = Math.max(0, input.context.settings.postFrequencyPerWeek);
      const windows = cadence > 0
        ? Array.from({ length: cadence }, (_value, index) => `+${index + 1}d`)
        : toStringArray(input.action.payload.windows);
      return {
        objective: input.objective,
        status: "scheduled_metadata_only",
        windows,
        postFrequencyPerWeek: input.context.settings.postFrequencyPerWeek,
        locationCount: input.context.locations.length
      };
    }

    const postCountFromSettings = Math.max(1, input.context.settings.postFrequencyPerWeek || 1);
    const postCount = Math.max(
      1,
      Math.min(
        this.options.maxPostBurst,
        toNumber(input.action.payload.postCount, postCountFromSettings)
      )
    );
    const ctaUrlFromPayload = normalizeHttpUrl(
      typeof input.action.payload.ctaUrl === "string" ? input.action.payload.ctaUrl : null
    );
    const mediaUrlFromPayload = normalizeHttpUrl(
      typeof input.action.payload.mediaUrl === "string" ? input.action.payload.mediaUrl : null
    );
    const selectedAssetIds = new Set(input.context.settings.photoAssetIds);
    const allowedAssets = input.context.mediaAssets.filter((asset) => {
      if (!asset.isAllowedForPosts) {
        return false;
      }
      if (selectedAssetIds.size > 0 && !selectedAssetIds.has(asset.id)) {
        return false;
      }
      return true;
    });
    if (!mediaUrlFromPayload && allowedAssets.length === 0) {
      throw new Error(
        "No approved client media assets are available for GBP posting. Upload assets in client settings and mark them allowed."
      );
    }
    const publishedPosts: Array<Record<string, unknown>> = [];
    const failed: Array<Record<string, unknown>> = [];
    const generatedLongFormDrafts: Array<Record<string, unknown>> = [];
    const executionWarnings: string[] = [];
    const sitemapUrls = await this.loadSitemapUrls(input.context.settings.sitemapUrl);
    if (normalizeHttpUrl(input.context.settings.sitemapUrl) && sitemapUrls.length === 0) {
      executionWarnings.push("Configured sitemap URL did not return usable page URLs; fallback URL strategy was used.");
    }

    for (let index = 0; index < postCount; index += 1) {
      const location = input.context.locations[index % input.context.locations.length];
      const selectedAsset =
        allowedAssets.length > 0 ? allowedAssets[index % allowedAssets.length] : null;
      const landing = this.selectLandingUrl({
        action: input.action,
        context: input.context,
        location,
        index,
        sitemapUrls
      });
      const tinyUrlResult = await this.createTinyUrl(landing.landingUrl);
      if (!tinyUrlResult.success && tinyUrlResult.error) {
        executionWarnings.push(`TinyURL fallback for ${landing.landingUrl}: ${tinyUrlResult.error}`);
      }

      const ctaUrl = ctaUrlFromPayload ?? tinyUrlResult.tinyUrl;
      const pageContext = await this.fetchLandingPageContext(landing.landingUrl);

      let mediaUrl: string | undefined = mediaUrlFromPayload ?? undefined;
      let processedStoragePath: string | null = null;
      let mediaGenerationError: string | null = null;
      if (!mediaUrl && selectedAsset) {
        const mediaResult = await this.generateQrOverlayMedia({
          asset: selectedAsset,
          clientId: input.action.clientId ?? input.context.connection.clientId,
          actionId: input.action.id,
          qrUrl: landing.landingUrl
        });
        mediaUrl = mediaResult.mediaUrl ?? undefined;
        processedStoragePath = mediaResult.processedStoragePath;
        mediaGenerationError = mediaResult.error;
      }

      const eeatDraft = buildEeatLongFormPost({
        locationTitle: location.title ?? "our business",
        objective: input.objective,
        ordinal: index + 1,
        tone: input.context.settings.tone,
        wordRange: {
          min: input.context.settings.postWordCountMin,
          max: input.context.settings.postWordCountMax
        },
        landingUrl: landing.landingUrl,
        shortUrl: tinyUrlResult.tinyUrl,
        pageContext,
        ctaUrl
      });
      const summary = input.context.settings.eeatStructuredSnippetEnabled
        ? eeatDraft.snippet
        : buildPostSummary({
            locationTitle: location.title ?? "our business",
            objective: input.objective,
            ordinal: index + 1,
            payload: input.action.payload
          });

      try {
        const response = await input.context.client.publishLocalPost(location.accountId, location.locationId, {
          summary,
          topicType: "STANDARD",
          mediaUrl,
          ctaUrl
        });
        generatedLongFormDrafts.push({
          locationName: location.locationName,
          locationId: location.locationId,
          mediaAssetId: selectedAsset?.id ?? null,
          mediaProcessedStoragePath: processedStoragePath,
          mediaGenerationError,
          ctaUrl,
          sourceLandingUrl: landing.landingUrl,
          tinyUrl: tinyUrlResult.tinyUrl,
          urlSource: landing.source,
          pageContext,
          wordCount: wordCount(eeatDraft.longForm),
          longForm: eeatDraft.longForm
        });
        publishedPosts.push({
          name: response.name,
          accountId: location.accountId,
          locationId: location.locationId,
          locationName: location.locationName,
          title: location.title,
          mediaAssetId: selectedAsset?.id ?? null,
          mediaProcessedStoragePath: processedStoragePath,
          sourceLandingUrl: landing.landingUrl,
          tinyUrl: tinyUrlResult.tinyUrl,
          urlSource: landing.source,
          ctaUrl
        });
      } catch (error) {
        failed.push({
          accountId: location.accountId,
          locationId: location.locationId,
          locationName: location.locationName,
          sourceLandingUrl: landing.landingUrl,
          tinyUrl: tinyUrlResult.tinyUrl,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    if (!publishedPosts.length) {
      throw new Error(`Post publish failed for all attempts: ${failed[0]?.error ?? "unknown error"}`);
    }

    return {
      objective: input.objective,
      postCountRequested: postCount,
      postCountPublished: publishedPosts.length,
      postFrequencyPerWeek: input.context.settings.postFrequencyPerWeek,
      eeatStructuredSnippetEnabled: input.context.settings.eeatStructuredSnippetEnabled,
      postWordRange: {
        min: input.context.settings.postWordCountMin,
        max: input.context.settings.postWordCountMax
      },
      sitemapUrl: input.context.settings.sitemapUrl,
      sitemapUrlsDiscovered: sitemapUrls.length,
      warnings: executionWarnings,
      publishedPosts,
      generatedLongFormDrafts,
      failedPublishes: failed
    };
  }

  private async executeReviewReplies(input: {
    action: BlitzAction;
    context: RunContext;
  }): Promise<Record<string, unknown>> {
    const maxReplies = Math.max(
      1,
      Math.min(this.options.maxReviewRepliesPerAction, toNumber(input.action.payload.maxReplies, 25))
    );
    const replied: Array<Record<string, unknown>> = [];
    const failed: Array<Record<string, unknown>> = [];
    let pending = 0;

    for (const location of input.context.locations) {
      if (replied.length >= maxReplies) {
        break;
      }

      const reviews = await input.context.client.fetchReviews(location.accountId, location.locationId);
      const pendingReviews = reviews.filter((review) => !review.reviewReply);
      pending += pendingReviews.length;

      for (const review of pendingReviews) {
        if (replied.length >= maxReplies) {
          break;
        }

        const reviewId = parseReviewId(review.name, review.reviewId);
        const alreadyPosted = await this.deps.repository.hasPostedReplyHistory(input.action.clientId ?? input.context.connection.clientId, reviewId);
        if (alreadyPosted) {
          continue;
        }
        const starRating = parseStarRating(review.starRating);
        const replyText = replyForReview({
          reviewerName: review.reviewer?.displayName ?? "there",
          starRating,
          comment: review.comment ?? "",
          locationTitle: location.title ?? "our business",
          tone: input.context.settings.tone,
          style: input.context.settings.reviewReplyStyle
        });

        try {
          await input.context.client.postReviewReply(location.accountId, location.locationId, reviewId, replyText);
          await this.deps.repository.recordReviewReplyHistory({
            organizationId: input.action.organizationId ?? input.context.connection.organizationId,
            clientId: input.action.clientId ?? input.context.connection.clientId,
            locationId: location.locationId,
            reviewId,
            reviewRating: starRating,
            reviewText: review.comment ?? "",
            replyText,
            replyStatus: "posted"
          });
          replied.push({
            reviewName: review.name,
            reviewId,
            locationName: location.locationName,
            accountId: location.accountId,
            rating: starRating
          });
        } catch (error) {
          await this.deps.repository.recordReviewReplyHistory({
            organizationId: input.action.organizationId ?? input.context.connection.organizationId,
            clientId: input.action.clientId ?? input.context.connection.clientId,
            locationId: location.locationId,
            reviewId,
            reviewRating: starRating,
            reviewText: review.comment ?? "",
            replyText,
            replyStatus: "failed",
            error: error instanceof Error ? error.message : String(error)
          });
          failed.push({
            reviewName: review.name,
            reviewId,
            locationName: location.locationName,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }

    if (pending > 0 && replied.length === 0) {
      throw new Error(`Review reply action found pending reviews but failed to post replies: ${failed[0]?.error ?? "unknown error"}`);
    }

    return {
      objective: input.action.payload.objective ?? "auto_reply_all_pending_reviews",
      pendingReviewsFound: pending,
      repliesPosted: replied.length,
      repliesFailed: failed.length,
      replied,
      failed
    };
  }

  private async executeHoursUpdate(input: {
    action: BlitzAction;
    context: RunContext;
  }): Promise<Record<string, unknown>> {
    const hoursPatch = asRecord(input.action.payload.hoursPatch);
    const updateMask = toStringArray(input.action.payload.updateMask);

    if (Object.keys(hoursPatch).length > 0 && updateMask.length > 0) {
      const updated: string[] = [];
      const failed: Array<Record<string, unknown>> = [];
      for (const location of input.context.locations) {
        try {
          await input.context.client.patchLocation(location.locationName, hoursPatch, updateMask);
          updated.push(location.locationName);
        } catch (error) {
          failed.push({
            locationName: location.locationName,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      if (!updated.length) {
        throw new Error(`Hours update failed across scoped locations: ${failed[0]?.error ?? "unknown error"}`);
      }

      return {
        objective: input.action.payload.objective ?? "cta_and_timing_optimizer",
        updatedLocations: updated,
        failedLocations: failed
      };
    }

    return {
      objective: input.action.payload.objective ?? "cta_and_timing_optimizer",
      status: "no_hours_patch_provided",
      locationCount: input.context.locations.length
    };
  }

  private isTokenExpiring(token: TokenPayload, bufferSeconds: number): boolean {
    const expiresAtMs = new Date(token.expiresAt).getTime();
    if (Number.isNaN(expiresAtMs)) {
      return false;
    }
    return expiresAtMs - Date.now() <= bufferSeconds * 1000;
  }
}
