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

interface GeneratedPostCopy {
  longForm: string;
  snippet: string;
  provider: "gemini" | "template";
  model: string | null;
  warning?: string;
}

interface CompetitorRecord {
  name: string;
  formattedAddress: string | null;
  rating: number | null;
  userRatingCount: number | null;
  primaryType: string | null;
  types: string[];
  websiteUri: string | null;
  distanceMiles?: number | null;
  relevanceScore?: number;
  rankPosition?: number;
}

interface LocationSemanticSuggestions {
  profileDescription: string | null;
  qaPairs: Array<{ question: string; answer: string }>;
  usps: string[];
  suggestedCategories: string[];
  suggestedServices: string[];
  suggestedProducts: string[];
  suggestedAttributes: string[];
  hoursRecommendations: string[];
  warning?: string;
  model?: string | null;
}

interface GeoPoint {
  lat: number;
  lng: number;
}

interface LocationRichSnapshot {
  locationName: string;
  title: string | null;
  websiteUri: string | null;
  profileDescription: string | null;
  categories: string[];
  attributes: string[];
  regularHours: Record<string, unknown> | null;
  storefrontAddress: Record<string, unknown> | null;
  formattedAddress: string | null;
  geo: GeoPoint | null;
  reviewCount: number;
  averageRating: number;
  postCount30d: number;
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

function parseJsonObjectFromText(value: string): Record<string, unknown> | null {
  const attempts = [
    value.trim(),
    value
      .replace(/^```json/i, "")
      .replace(/^```/i, "")
      .replace(/```$/i, "")
      .trim()
  ].filter(Boolean);

  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Continue trying fallback extraction paths.
    }
  }

  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const subset = value.slice(start, end + 1);
    try {
      const parsed = JSON.parse(subset);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }

  return null;
}

function normalizeBusinessName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function categoryLabel(value: unknown): string | null {
  if (typeof value === "string") {
    const normalized = normalizeText(value);
    return normalized || null;
  }
  const record = asRecord(value);
  const candidates = [
    typeof record.displayName === "string" ? record.displayName : null,
    typeof record.name === "string" ? record.name : null
  ].filter((entry): entry is string => Boolean(entry));
  return candidates[0] ? normalizeText(candidates[0]) : null;
}

function addressFromStorefront(storefront: Record<string, unknown> | null): string | null {
  if (!storefront) {
    return null;
  }

  const addressLines = Array.isArray(storefront.addressLines)
    ? storefront.addressLines.map(String).map((line) => line.trim()).filter(Boolean)
    : [];
  if (addressLines.length) {
    return addressLines.join(", ");
  }

  const parts = [
    typeof storefront.locality === "string" ? storefront.locality : null,
    typeof storefront.administrativeArea === "string" ? storefront.administrativeArea : null,
    typeof storefront.postalCode === "string" ? storefront.postalCode : null
  ].filter((entry): entry is string => Boolean(entry));
  if (parts.length) {
    return parts.join(", ");
  }

  return null;
}

function formatCityState(storefront: Record<string, unknown> | null): string | null {
  if (!storefront) {
    return null;
  }
  const locality = typeof storefront.locality === "string" ? storefront.locality.trim() : "";
  const state = typeof storefront.administrativeArea === "string" ? storefront.administrativeArea.trim() : "";
  if (locality && state) {
    return `${locality}, ${state}`;
  }
  return locality || state || null;
}

function haversineMiles(a: GeoPoint, b: GeoPoint): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadiusMiles = 3959;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const inner =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(inner), Math.sqrt(1 - inner));
  return earthRadiusMiles * c;
}

function safeAverage(values: number[]): number {
  if (!values.length) {
    return 0;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function normalizeRating(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(5, value));
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.min(5, parsed));
    }
  }
  return 0;
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

  private buildGeminiPrompt(input: {
    locationTitle: string;
    objective: string;
    tone: string;
    wordRange: { min: number; max: number };
    landingUrl: string;
    shortUrl: string;
    pageContext: LandingPageContext;
    objectives: string[];
  }): string {
    const pageTitle = input.pageContext.pageTitle ?? "N/A";
    const pageH1 = input.pageContext.h1 ?? "N/A";
    const metaDescription = input.pageContext.metaDescription ?? "N/A";
    const firstParagraph = input.pageContext.firstParagraph ?? "N/A";
    const businessObjectives = input.objectives.length ? input.objectives.join("; ") : "Increase local visibility and conversions";

    return [
      "You are a senior local SEO content writer producing GBP post copy.",
      "Write natural, humanized copy with no robotic filler and no hype.",
      "",
      "Return STRICT JSON only with this exact shape:",
      "{",
      '  "longForm": "string",',
      '  "snippet": "string"',
      "}",
      "",
      "Rules:",
      `- longForm must be between ${input.wordRange.min} and ${input.wordRange.max} words.`,
      "- snippet must be <= 1450 characters and ready to publish as GBP post summary.",
      "- Format longForm using readable markdown sections and short paragraphs.",
      "- Include one compact bullet list under a section named Structured Snippet.",
      "- Keep tone professional, local-expert, and conversational.",
      "- Anchor the post semantically to the landing page topic and user intent.",
      "- Include a clear conversion CTA with the short URL.",
      "- Do not use emojis.",
      "",
      "Context:",
      `- Business: ${input.locationTitle}`,
      `- Objective: ${input.objective}`,
      `- Tone: ${input.tone}`,
      `- Landing URL: ${input.landingUrl}`,
      `- Short URL: ${input.shortUrl}`,
      `- Page title: ${pageTitle}`,
      `- Page H1: ${pageH1}`,
      `- Meta description: ${metaDescription}`,
      `- First paragraph: ${firstParagraph}`,
      `- Business objectives: ${businessObjectives}`,
      "",
      "Output requirements:",
      "- longForm should read like a polished local service update and align with AI retrieval relevance (EEAT, factual clarity, local intent).",
      "- snippet should be concise, actionable, and optimized for GBP readability with the short URL.",
      "",
      "Now return JSON only."
    ].join("\n");
  }

  private async generatePostCopy(input: {
    locationTitle: string;
    objective: string;
    ordinal: number;
    tone: string;
    wordRange: { min: number; max: number };
    landingUrl: string;
    shortUrl: string;
    pageContext: LandingPageContext;
    objectives: string[];
    ctaUrl?: string | null;
  }): Promise<GeneratedPostCopy> {
    const fallback = buildEeatLongFormPost({
      locationTitle: input.locationTitle,
      objective: input.objective,
      ordinal: input.ordinal,
      tone: input.tone,
      wordRange: input.wordRange,
      landingUrl: input.landingUrl,
      shortUrl: input.shortUrl,
      pageContext: input.pageContext,
      ctaUrl: input.ctaUrl
    });

    const apiKey =
      process.env.GEMINI_API_KEY?.trim() ??
      process.env.GOOGLE_AI_STUDIO_API_KEY?.trim() ??
      process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ??
      process.env.GOOGLE_API_KEY?.trim() ??
      null;
    const model = process.env.GEMINI_MODEL?.trim() || "gemini-2.0-flash";

    if (!apiKey) {
      return {
        longForm: fallback.longForm,
        snippet: fallback.snippet,
        provider: "template",
        model: null,
        warning: "Gemini API key is not configured. Falling back to deterministic template output."
      };
    }

    try {
      const prompt = this.buildGeminiPrompt({
        locationTitle: input.locationTitle,
        objective: input.objective,
        tone: input.tone,
        wordRange: input.wordRange,
        landingUrl: input.landingUrl,
        shortUrl: input.shortUrl,
        pageContext: input.pageContext,
        objectives: input.objectives
      });

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [{ text: prompt }]
              }
            ],
            generationConfig: {
              temperature: 0.7,
              topP: 0.9,
              maxOutputTokens: 2200
            }
          })
        }
      );

      if (!response.ok) {
        const responseText = await response.text().catch(() => "");
        return {
          longForm: fallback.longForm,
          snippet: fallback.snippet,
          provider: "template",
          model,
          warning: `Gemini API returned ${response.status}: ${responseText.slice(0, 220)}`
        };
      }

      const payload = (await response.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{ text?: string }>;
          };
        }>;
      };

      const rawText = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n").trim() ?? "";
      const parsed = parseJsonObjectFromText(rawText);
      const modelLongForm = parsed && typeof parsed.longForm === "string" ? parsed.longForm.trim() : "";
      const modelSnippet = parsed && typeof parsed.snippet === "string" ? parsed.snippet.trim() : "";

      if (!modelLongForm || !modelSnippet) {
        return {
          longForm: fallback.longForm,
          snippet: fallback.snippet,
          provider: "template",
          model,
          warning: "Gemini response did not provide valid JSON longForm/snippet."
        };
      }

      let longForm = modelLongForm;
      if (wordCount(longForm) < input.wordRange.min) {
        longForm = fallback.longForm;
      }
      if (wordCount(longForm) > input.wordRange.max) {
        longForm = truncateToMaxWords(longForm, input.wordRange.max);
      }

      let snippet = modelSnippet.slice(0, 1450);
      if (!snippet.includes(input.shortUrl)) {
        snippet = `${snippet} Learn more: ${input.shortUrl}`.slice(0, 1450);
      }

      return {
        longForm,
        snippet,
        provider: "gemini",
        model
      };
    } catch (error) {
      return {
        longForm: fallback.longForm,
        snippet: fallback.snippet,
        provider: "template",
        model,
        warning: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async requestJsonWithAuth<T>(input: {
    url: string;
    accessToken: string;
    method?: "GET" | "POST" | "PATCH";
    body?: Record<string, unknown>;
    timeoutMs?: number;
  }): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 15000);
    try {
      const response = await fetch(input.url, {
        method: input.method ?? "GET",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          "Content-Type": "application/json"
        },
        body: input.body ? JSON.stringify(input.body) : undefined
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`HTTP ${response.status} ${response.statusText} ${body.slice(0, 280)}`.trim());
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private extractLocationCategories(location: Record<string, unknown>): string[] {
    const rawCategories = Array.isArray(location.categories) ? location.categories : [];
    const labels = rawCategories.map((entry) => categoryLabel(entry)).filter((entry): entry is string => Boolean(entry));
    return [...new Set(labels)];
  }

  private extractLocationAttributes(location: Record<string, unknown>): string[] {
    const rawAttributes = Array.isArray(location.attributes) ? location.attributes : [];
    const labels = rawAttributes
      .map((attribute) => {
        const record = asRecord(attribute);
        const displayName = typeof record.displayName === "string" ? record.displayName : null;
        if (displayName) {
          return normalizeText(displayName);
        }
        const name = typeof record.name === "string" ? record.name : null;
        if (name) {
          return normalizeText(name);
        }
        return null;
      })
      .filter((entry): entry is string => Boolean(entry));
    return [...new Set(labels)];
  }

  private extractProfileDescription(location: Record<string, unknown>): string | null {
    const profile = asRecord(location.profile);
    const candidates = [
      typeof profile.description === "string" ? profile.description : null,
      typeof profile.summary === "string" ? profile.summary : null,
      typeof location.description === "string" ? location.description : null
    ].filter((entry): entry is string => Boolean(entry));
    if (!candidates.length) {
      return null;
    }
    return normalizeText(candidates[0]);
  }

  private extractLocationGeo(location: Record<string, unknown>): GeoPoint | null {
    const latlng = asRecord(location.latlng);
    const latitude = toNumber(latlng.latitude, Number.NaN);
    const longitude = toNumber(latlng.longitude, Number.NaN);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return { lat: latitude, lng: longitude };
    }

    const metadata = asRecord(location.metadata);
    const lat = toNumber(metadata.lat, Number.NaN);
    const lng = toNumber(metadata.lng, Number.NaN);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }
    return null;
  }

  private async fetchLocationWithExtendedMask(input: {
    accessToken: string;
    locationName: string;
  }): Promise<Record<string, unknown>> {
    const masks = [
      "name,title,storefrontAddress,websiteUri,phoneNumbers,regularHours,categories,profile,attributes,serviceAreaBusiness",
      "name,title,storefrontAddress,websiteUri,phoneNumbers,regularHours,categories,profile,serviceAreaBusiness",
      "name,title,storefrontAddress,websiteUri,phoneNumbers,regularHours,profile",
      "name,title,storefrontAddress,websiteUri,phoneNumbers,regularHours"
    ];

    for (const mask of masks) {
      const endpoint = new URL(`https://mybusinessbusinessinformation.googleapis.com/v1/${input.locationName}`);
      endpoint.searchParams.set("readMask", mask);
      try {
        return await this.requestJsonWithAuth<Record<string, unknown>>({
          url: endpoint.toString(),
          accessToken: input.accessToken
        });
      } catch {
        // Try next compatible readMask.
      }
    }

    return {};
  }

  private async geocodeAddress(address: string): Promise<GeoPoint | null> {
    const apiKey =
      process.env.GOOGLE_PLACES_API_KEY?.trim() ??
      process.env.GOOGLE_MAPS_API_KEY?.trim() ??
      process.env.GOOGLE_API_KEY?.trim() ??
      null;
    if (!apiKey) {
      return null;
    }

    try {
      const endpoint = new URL("https://maps.googleapis.com/maps/api/geocode/json");
      endpoint.searchParams.set("address", address);
      endpoint.searchParams.set("key", apiKey);
      const response = await fetch(endpoint.toString(), {
        headers: {
          Accept: "application/json"
        }
      });
      if (!response.ok) {
        return null;
      }
      const payload = (await response.json()) as {
        status?: string;
        results?: Array<{
          geometry?: {
            location?: {
              lat?: number;
              lng?: number;
            };
          };
        }>;
      };

      if (payload.status !== "OK") {
        return null;
      }
      const point = payload.results?.[0]?.geometry?.location;
      if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
        return null;
      }
      return {
        lat: Number(point.lat),
        lng: Number(point.lng)
      };
    } catch {
      return null;
    }
  }

  private async resolveLocationGeo(snapshot: {
    storefrontAddress: Record<string, unknown> | null;
    geo: GeoPoint | null;
    formattedAddress: string | null;
  }): Promise<GeoPoint | null> {
    if (snapshot.geo) {
      return snapshot.geo;
    }

    const formatted = snapshot.formattedAddress ?? addressFromStorefront(snapshot.storefrontAddress);
    if (!formatted) {
      return null;
    }
    return this.geocodeAddress(formatted);
  }

  private async fetchLocationSnapshot(input: {
    context: RunContext;
    location: ResolvedLocation;
  }): Promise<LocationRichSnapshot> {
    const fallback = await input.context.client.fetchLocation(input.location.locationName).catch(() => null);
    const detail = await this.fetchLocationWithExtendedMask({
      accessToken: input.context.token.accessToken,
      locationName: input.location.locationName
    }).catch(() => ({}));

    const merged = {
      ...(fallback ? asRecord(fallback as unknown) : {}),
      ...detail
    };
    const storefrontAddress = asRecord(merged.storefrontAddress);
    const formattedAddress = addressFromStorefront(storefrontAddress) ?? null;
    const existingGeo = this.extractLocationGeo(merged);
    const resolvedGeo = await this.resolveLocationGeo({
      storefrontAddress,
      geo: existingGeo,
      formattedAddress
    });

    const reviews = await input.context.client
      .fetchReviews(input.location.accountId, input.location.locationId)
      .catch(() => []);
    const posts = await input.context.client
      .listPosts(input.location.accountId, input.location.locationId)
      .catch(() => []);

    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const postCount30d = posts.filter((post) => {
      const timestamp = post.updateTime ?? post.createTime ?? null;
      if (!timestamp) {
        return false;
      }
      const timeMs = new Date(timestamp).getTime();
      return Number.isFinite(timeMs) && timeMs >= thirtyDaysAgo;
    }).length;

    return {
      locationName: input.location.locationName,
      title: (typeof merged.title === "string" ? merged.title : null) ?? input.location.title,
      websiteUri:
        normalizeHttpUrl(typeof merged.websiteUri === "string" ? merged.websiteUri : null) ??
        normalizeHttpUrl(input.location.websiteUri),
      profileDescription: this.extractProfileDescription(merged),
      categories: this.extractLocationCategories(merged),
      attributes: this.extractLocationAttributes(merged),
      regularHours: Object.keys(asRecord(merged.regularHours)).length ? asRecord(merged.regularHours) : null,
      storefrontAddress: Object.keys(storefrontAddress).length ? storefrontAddress : null,
      formattedAddress,
      geo: resolvedGeo,
      reviewCount: reviews.length,
      averageRating: safeAverage(reviews.map((review) => parseStarRating(review.starRating))),
      postCount30d
    };
  }

  private async discoverTopCompetitors(input: {
    snapshot: LocationRichSnapshot;
    location: ResolvedLocation;
    objectives: string[];
    maxResults?: number;
  }): Promise<CompetitorRecord[]> {
    const apiKey =
      process.env.GOOGLE_PLACES_API_KEY?.trim() ??
      process.env.GOOGLE_MAPS_API_KEY?.trim() ??
      process.env.GOOGLE_API_KEY?.trim() ??
      null;
    if (!apiKey) {
      return [];
    }

    const limit = clamp(toNumber(input.maxResults, 5), 3, 10);
    const radiusMeters = 16000;
    const primaryCategory = input.snapshot.categories[0] ?? null;
    const cityState = formatCityState(input.snapshot.storefrontAddress);
    const objectiveHint = input.objectives[0] ? readableObjective(input.objectives[0]) : "local services";
    const query = primaryCategory
      ? `${primaryCategory} near ${cityState ?? input.snapshot.formattedAddress ?? ""}`.trim()
      : `${input.snapshot.title ?? input.location.title ?? "Local business"} ${objectiveHint}`.trim();

    const endpoint = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
    endpoint.searchParams.set("query", query);
    if (input.snapshot.geo) {
      endpoint.searchParams.set("location", `${input.snapshot.geo.lat},${input.snapshot.geo.lng}`);
      endpoint.searchParams.set("radius", String(radiusMeters));
    }
    endpoint.searchParams.set("key", apiKey);

    try {
      const payload = await fetch(endpoint.toString(), {
        headers: {
          Accept: "application/json"
        }
      }).then(async (response) => {
        if (!response.ok) {
          throw new Error(`Places API HTTP ${response.status}`);
        }
        return (await response.json()) as {
          status?: string;
          results?: Array<Record<string, unknown>>;
        };
      });

      if (!(payload.status === "OK" || payload.status === "ZERO_RESULTS")) {
        return [];
      }

      const ownName = normalizeBusinessName(input.snapshot.title ?? input.location.title ?? "");
      const parsedCompetitors: CompetitorRecord[] = [];
      for (const row of payload.results ?? []) {
        const name = typeof row.name === "string" ? normalizeText(row.name) : "";
        if (!name) {
          continue;
        }

        const geometry = asRecord(row.geometry);
        const locationPoint = asRecord(geometry.location);
        const lat = toNumber(locationPoint.lat, Number.NaN);
        const lng = toNumber(locationPoint.lng, Number.NaN);
        const geo = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
        const distanceMiles = input.snapshot.geo && geo ? haversineMiles(input.snapshot.geo, geo) : null;
        const rating = normalizeRating(row.rating);
        const reviewCount = toNumber(row.user_ratings_total, 0);
        const types = toStringArray(row.types);
        const formattedAddress =
          typeof row.formatted_address === "string"
            ? row.formatted_address
            : typeof row.vicinity === "string"
              ? row.vicinity
              : null;

        let relevance = 50;
        relevance += rating * 6;
        relevance += Math.min(20, reviewCount / 12);
        if (distanceMiles !== null) {
          relevance -= Math.min(20, distanceMiles * 1.6);
        }
        if (primaryCategory && types.some((type) => type.toLowerCase().includes(primaryCategory.toLowerCase().split(" ")[0]))) {
          relevance += 8;
        }
        relevance = clamp(Math.round(relevance), 0, 100);

        parsedCompetitors.push({
          name,
          formattedAddress,
          rating: rating || null,
          userRatingCount: reviewCount || null,
          primaryType: types.length ? types[0] ?? null : null,
          types,
          websiteUri: null,
          distanceMiles,
          relevanceScore: relevance
        });
      }

      const competitors = parsedCompetitors
        .filter((entry) => normalizeBusinessName(entry.name) !== ownName)
        .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0))
        .slice(0, limit)
        .map((entry, index) => ({ ...entry, rankPosition: index + 1 }));

      return competitors;
    } catch {
      return [];
    }
  }

  private buildSemanticSuggestionPrompt(input: {
    location: ResolvedLocation;
    snapshot: LocationRichSnapshot;
    competitors: CompetitorRecord[];
    objectives: string[];
  }): string {
    const locationName = input.snapshot.title ?? input.location.title ?? "This business";
    const cityState = formatCityState(input.snapshot.storefrontAddress) ?? "local area";
    const currentCategories = input.snapshot.categories.length ? input.snapshot.categories.join(", ") : "none";
    const competitorLines = input.competitors.length
      ? input.competitors
          .map((competitor) => {
            const rating = competitor.rating ? `${competitor.rating.toFixed(1)}★` : "n/a";
            const reviews = competitor.userRatingCount ?? 0;
            return `- ${competitor.name} | rating ${rating} | reviews ${reviews} | type ${competitor.primaryType ?? "n/a"}`
          })
          .join("\n")
      : "- none available";
    const objectiveLine = input.objectives.length ? input.objectives.join("; ") : "Increase qualified local conversions";

    return [
      "You are an expert Google Business Profile strategist.",
      "Generate profile optimization data for the business below.",
      "",
      "Return STRICT JSON with this exact shape:",
      "{",
      '  "profileDescription": "string",',
      '  "qaPairs": [{"question":"string","answer":"string"}],',
      '  "usps": ["string"],',
      '  "suggestedCategories": ["string"],',
      '  "suggestedServices": ["string"],',
      '  "suggestedProducts": ["string"],',
      '  "suggestedAttributes": ["string"],',
      '  "hoursRecommendations": ["string"]',
      "}",
      "",
      "Rules:",
      "- Keep profileDescription 400-740 characters.",
      "- Include hyperlocal wording and concrete service outcomes.",
      "- qaPairs should be 8 to 12 high-intent GBP questions and concise answers.",
      "- suggestedServices and suggestedProducts should be declarative and conversion-focused.",
      "- Do not hallucinate unsupported guarantees.",
      "",
      "Business context:",
      `- Business: ${locationName}`,
      `- Local area: ${cityState}`,
      `- Current categories: ${currentCategories}`,
      `- Current review count: ${input.snapshot.reviewCount}`,
      `- Current rating: ${input.snapshot.averageRating.toFixed(2)}`,
      `- Current website: ${input.snapshot.websiteUri ?? "missing"}`,
      `- Objectives: ${objectiveLine}`,
      "",
      "Top competitors:",
      competitorLines,
      "",
      "Return JSON only."
    ].join("\n");
  }

  private buildFallbackSemanticSuggestions(input: {
    location: ResolvedLocation;
    snapshot: LocationRichSnapshot;
    objectives: string[];
  }): LocationSemanticSuggestions {
    const locationTitle = input.snapshot.title ?? input.location.title ?? "our business";
    const cityState = formatCityState(input.snapshot.storefrontAddress) ?? "the local area";
    const objectiveLine = input.objectives[0] ? readableObjective(input.objectives[0]) : "local visibility";
    const description = [
      `${locationTitle} serves customers across ${cityState} with clear scope, reliable communication, and outcome-focused service delivery.`,
      `Our team prioritizes ${objectiveLine}, transparent turnaround expectations, and practical recommendations tailored to local demand.`,
      "Contact us for current availability and same-day guidance where applicable."
    ].join(" ");

    return {
      profileDescription: truncateToMaxWords(description, 120),
      qaPairs: [
        {
          question: `What areas does ${locationTitle} serve?`,
          answer: `${locationTitle} serves ${cityState} and nearby neighborhoods with location-specific scheduling support.`
        },
        {
          question: `How quickly can I get started with ${locationTitle}?`,
          answer: "Most inquiries are answered quickly with scheduling options based on current service capacity."
        }
      ],
      usps: [
        "Local service coverage with transparent response windows",
        "Structured delivery process with clear customer communication"
      ],
      suggestedCategories: input.snapshot.categories.slice(0, 3),
      suggestedServices: input.objectives.slice(0, 4).map((objective) => `${readableObjective(objective)} service`),
      suggestedProducts: [],
      suggestedAttributes: input.snapshot.attributes.slice(0, 6),
      hoursRecommendations: []
    };
  }

  private async generateLocationSemanticSuggestions(input: {
    location: ResolvedLocation;
    snapshot: LocationRichSnapshot;
    competitors: CompetitorRecord[];
    objectives: string[];
  }): Promise<LocationSemanticSuggestions> {
    const fallback = this.buildFallbackSemanticSuggestions({
      location: input.location,
      snapshot: input.snapshot,
      objectives: input.objectives
    });
    const apiKey =
      process.env.GEMINI_API_KEY?.trim() ??
      process.env.GOOGLE_AI_STUDIO_API_KEY?.trim() ??
      process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ??
      process.env.GOOGLE_API_KEY?.trim() ??
      null;
    const model = process.env.GEMINI_MODEL?.trim() || "gemini-2.0-flash";

    if (!apiKey) {
      return {
        ...fallback,
        warning: "Gemini API key not configured; semantic suggestions generated from fallback rules.",
        model: null
      };
    }

    try {
      const prompt = this.buildSemanticSuggestionPrompt({
        location: input.location,
        snapshot: input.snapshot,
        competitors: input.competitors,
        objectives: input.objectives
      });
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.55,
              topP: 0.9,
              maxOutputTokens: 1800
            }
          })
        }
      );
      if (!response.ok) {
        return {
          ...fallback,
          warning: `Gemini API returned ${response.status}; fallback suggestions applied.`,
          model
        };
      }

      const payload = (await response.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
        }>;
      };
      const rawText = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n") ?? "";
      const parsed = parseJsonObjectFromText(rawText);
      if (!parsed) {
        return {
          ...fallback,
          warning: "Gemini output did not parse as JSON; fallback suggestions applied.",
          model
        };
      }

      const qaRaw = Array.isArray(parsed.qaPairs) ? parsed.qaPairs : [];
      const qaPairs = qaRaw
        .map((entry) => {
          const record = asRecord(entry);
          const question = typeof record.question === "string" ? normalizeText(record.question) : "";
          const answer = typeof record.answer === "string" ? normalizeText(record.answer) : "";
          if (!question || !answer) {
            return null;
          }
          return { question, answer };
        })
        .filter((entry): entry is { question: string; answer: string } => Boolean(entry))
        .slice(0, 20);

      return {
        profileDescription:
          typeof parsed.profileDescription === "string" && parsed.profileDescription.trim()
            ? parsed.profileDescription.trim().slice(0, 750)
            : fallback.profileDescription,
        qaPairs: qaPairs.length ? qaPairs : fallback.qaPairs,
        usps: toStringArray(parsed.usps).slice(0, 12),
        suggestedCategories: toStringArray(parsed.suggestedCategories).slice(0, 8),
        suggestedServices: toStringArray(parsed.suggestedServices).slice(0, 30),
        suggestedProducts: toStringArray(parsed.suggestedProducts).slice(0, 30),
        suggestedAttributes: toStringArray(parsed.suggestedAttributes).slice(0, 20),
        hoursRecommendations: toStringArray(parsed.hoursRecommendations).slice(0, 10),
        model
      };
    } catch (error) {
      return {
        ...fallback,
        warning: error instanceof Error ? error.message : String(error),
        model
      };
    }
  }

  private async runCompetitorBenchmark(input: {
    context: RunContext;
  }): Promise<Array<Record<string, unknown>>> {
    const rows: Array<Record<string, unknown>> = [];
    for (const location of input.context.locations) {
      const snapshot = await this.fetchLocationSnapshot({ context: input.context, location });
      const competitors = await this.discoverTopCompetitors({
        snapshot,
        location,
        objectives: input.context.settings.objectives,
        maxResults: 5
      });
      const avgCompetitorRating = safeAverage(
        competitors.map((competitor) => competitor.rating ?? 0).filter((value) => value > 0)
      );
      const avgCompetitorReviewCount = safeAverage(
        competitors.map((competitor) => competitor.userRatingCount ?? 0).filter((value) => value > 0)
      );

      const missing: string[] = [];
      if (!snapshot.categories.length) {
        missing.push("categories");
      }
      if (!snapshot.profileDescription) {
        missing.push("profile.description");
      }
      if (!snapshot.websiteUri) {
        missing.push("websiteUri");
      }
      if (!snapshot.regularHours) {
        missing.push("regularHours");
      }
      if (!snapshot.attributes.length) {
        missing.push("attributes");
      }

      rows.push({
        accountId: location.accountId,
        locationName: location.locationName,
        title: snapshot.title ?? location.title,
        missing,
        benchmark: {
          reviewCount: snapshot.reviewCount,
          averageRating: Number(snapshot.averageRating.toFixed(2)),
          postCount30d: snapshot.postCount30d,
          avgCompetitorRating: Number(avgCompetitorRating.toFixed(2)),
          avgCompetitorReviewCount: Math.round(avgCompetitorReviewCount),
          ratingDeltaVsCompetitors: Number((snapshot.averageRating - avgCompetitorRating).toFixed(2)),
          reviewDeltaVsCompetitors: Math.round(snapshot.reviewCount - avgCompetitorReviewCount)
        },
        competitors
      });
    }
    return rows;
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

    if (input.objective === "ai_description_qna_optimization") {
      const patched: Array<Record<string, unknown>> = [];
      const skipped: Array<Record<string, unknown>> = [];
      const failed: Array<Record<string, unknown>> = [];
      const warnings = [...input.context.warnings];
      const generatedQaPayloads: Array<Record<string, unknown>> = [];

      for (const location of input.context.locations) {
        const snapshot = await this.fetchLocationSnapshot({ context: input.context, location });
        const competitors = await this.discoverTopCompetitors({
          snapshot,
          location,
          objectives: input.context.settings.objectives,
          maxResults: 5
        });
        const suggestions = await this.generateLocationSemanticSuggestions({
          location,
          snapshot,
          competitors,
          objectives: input.context.settings.objectives
        });
        if (suggestions.warning) {
          warnings.push(`${location.locationName}: ${suggestions.warning}`);
        }

        generatedQaPayloads.push({
          locationName: location.locationName,
          title: snapshot.title ?? location.title,
          qaPairs: suggestions.qaPairs,
          usps: suggestions.usps,
          suggestedCategories: suggestions.suggestedCategories,
          suggestedServices: suggestions.suggestedServices,
          suggestedProducts: suggestions.suggestedProducts,
          suggestedAttributes: suggestions.suggestedAttributes,
          hoursRecommendations: suggestions.hoursRecommendations,
          model: suggestions.model ?? null
        });

        const nextDescription = suggestions.profileDescription ? normalizeText(suggestions.profileDescription) : "";
        const currentDescription = snapshot.profileDescription ? normalizeText(snapshot.profileDescription) : "";
        if (!nextDescription || nextDescription === currentDescription) {
          skipped.push({
            locationName: location.locationName,
            reason: nextDescription ? "description_unchanged" : "no_description_generated"
          });
          continue;
        }

        try {
          await input.context.client.patchLocation(
            location.locationName,
            {
              profile: {
                description: nextDescription
              }
            },
            ["profile"]
          );
          patched.push({
            locationName: location.locationName,
            title: snapshot.title ?? location.title,
            previousDescriptionLength: currentDescription.length,
            nextDescriptionLength: nextDescription.length,
            competitorCount: competitors.length
          });
        } catch (error) {
          failed.push({
            locationName: location.locationName,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      if (!patched.length && failed.length && !skipped.length) {
        throw new Error(`AI description optimization failed for all locations: ${failed[0]?.error ?? "unknown error"}`);
      }

      return {
        objective: input.objective,
        patchedLocations: patched,
        skippedLocations: skipped,
        failedLocations: failed,
        qaOptimization: {
          apiStatus: "qa_api_deprecated_manual_queue_only",
          locationCount: generatedQaPayloads.length,
          generatedQaPayloads
        },
        warnings
      };
    }

    const checks = await Promise.all(
      input.context.locations.slice(0, 10).map(async (location) => {
        const snapshot = await this.fetchLocationSnapshot({ context: input.context, location });
        return {
          accountId: location.accountId,
          locationName: location.locationName,
          title: snapshot.title ?? location.title,
          hasCategories: snapshot.categories.length > 0,
          hasHours: Boolean(snapshot.regularHours),
          hasAttributes: snapshot.attributes.length > 0,
          hasProfileDescription: Boolean(snapshot.profileDescription),
          reviewCount: snapshot.reviewCount,
          averageRating: Number(snapshot.averageRating.toFixed(2)),
          postCount30d: snapshot.postCount30d
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
    const objective =
      typeof input.action.payload.objective === "string"
        ? input.action.payload.objective
        : "completeness_gap_matrix";

    if (objective === "competitor_benchmark_and_gap_matrix") {
      const matrix = await this.runCompetitorBenchmark({
        context: input.context
      });
      return {
        objective,
        locationsAnalyzed: matrix.length,
        benchmarked: true,
        gapMatrix: matrix
      };
    }

    if (objective === "auto_fill_profile_fields") {
      const applyRecommendations = input.action.payload.applyRecommendations !== false;
      const explicitHours = asRecord(input.action.payload.defaultRegularHours);
      const metadataHours = asRecord(asRecord(input.context.settings.metadata).defaultRegularHours);
      const defaultHours = Object.keys(explicitHours).length ? explicitHours : metadataHours;

      const patched: Array<Record<string, unknown>> = [];
      const skipped: Array<Record<string, unknown>> = [];
      const failed: Array<Record<string, unknown>> = [];
      const warnings = [...input.context.warnings];

      for (const location of input.context.locations) {
        const snapshot = await this.fetchLocationSnapshot({ context: input.context, location });
        const competitors = await this.discoverTopCompetitors({
          snapshot,
          location,
          objectives: input.context.settings.objectives,
          maxResults: 5
        });
        const suggestions = await this.generateLocationSemanticSuggestions({
          location,
          snapshot,
          competitors,
          objectives: input.context.settings.objectives
        });
        if (suggestions.warning) {
          warnings.push(`${location.locationName}: ${suggestions.warning}`);
        }

        const patch: Record<string, unknown> = {};
        const updateMask: string[] = [];
        const unavailableWrites: string[] = [];

        const profileDescription = suggestions.profileDescription ? suggestions.profileDescription.trim() : "";
        if (profileDescription) {
          patch.profile = {
            description: profileDescription
          };
          updateMask.push("profile");
        }

        if (!snapshot.websiteUri) {
          const fallbackWebsite =
            normalizeHttpUrl(input.context.settings.defaultPostUrl) ??
            normalizeHttpUrl(location.websiteUri);
          if (fallbackWebsite) {
            patch.websiteUri = fallbackWebsite;
            updateMask.push("websiteUri");
          }
        }

        if (!snapshot.categories.length && suggestions.suggestedCategories.length) {
          patch.categories = suggestions.suggestedCategories.slice(0, 4).map((category) => ({
            displayName: category
          }));
          updateMask.push("categories");
        }

        if (!snapshot.regularHours && Object.keys(defaultHours).length > 0) {
          patch.regularHours = defaultHours;
          updateMask.push("regularHours");
        }

        if (suggestions.suggestedAttributes.length > 0) {
          unavailableWrites.push("attributes");
        }
        if (suggestions.suggestedServices.length > 0) {
          unavailableWrites.push("services");
        }
        if (suggestions.suggestedProducts.length > 0) {
          unavailableWrites.push("products");
        }
        if (suggestions.qaPairs.length > 0) {
          unavailableWrites.push("q_and_a");
        }

        if (!applyRecommendations) {
          skipped.push({
            locationName: location.locationName,
            reason: "apply_recommendations_disabled",
            suggestedUpdateMask: [...new Set(updateMask)],
            unavailableWrites
          });
          continue;
        }

        const dedupedMask = [...new Set(updateMask)];
        if (!dedupedMask.length) {
          skipped.push({
            locationName: location.locationName,
            reason: "no_mutable_fields_needed",
            unavailableWrites
          });
          continue;
        }

        try {
          await input.context.client.patchLocation(location.locationName, patch, dedupedMask);
          patched.push({
            locationName: location.locationName,
            title: snapshot.title ?? location.title,
            updateMask: dedupedMask,
            unavailableWrites,
            suggestions: {
              usps: suggestions.usps,
              categories: suggestions.suggestedCategories,
              services: suggestions.suggestedServices,
              products: suggestions.suggestedProducts,
              attributes: suggestions.suggestedAttributes,
              hoursRecommendations: suggestions.hoursRecommendations,
              qaPairs: suggestions.qaPairs
            }
          });
        } catch (error) {
          failed.push({
            locationName: location.locationName,
            updateMask: dedupedMask,
            error: error instanceof Error ? error.message : String(error),
            unavailableWrites
          });
        }
      }

      if (!patched.length && failed.length && !skipped.length) {
        throw new Error(`Auto-fill profile fields failed for all locations: ${failed[0]?.error ?? "unknown error"}`);
      }

      return {
        objective,
        applyRecommendations,
        patchedLocations: patched,
        skippedLocations: skipped,
        failedLocations: failed,
        warnings
      };
    }

    const matrix = await Promise.all(
      input.context.locations.map(async (location) => {
        const snapshot = await this.fetchLocationSnapshot({ context: input.context, location });
        const missing: string[] = [];
        if (!snapshot.categories.length) {
          missing.push("categories");
        }
        if (!snapshot.regularHours) {
          missing.push("regularHours");
        }
        if (!snapshot.attributes.length) {
          missing.push("attributes");
        }
        if (!snapshot.profileDescription) {
          missing.push("profile.description");
        }
        if (!snapshot.websiteUri) {
          missing.push("websiteUri");
        }

        return {
          accountId: location.accountId,
          locationName: location.locationName,
          title: snapshot.title ?? location.title,
          missing,
          reviewCount: snapshot.reviewCount,
          averageRating: Number(snapshot.averageRating.toFixed(2)),
          postCount30d: snapshot.postCount30d
        };
      })
    );

    return {
      objective,
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

      const generatedCopy = await this.generatePostCopy({
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
        objectives: input.context.settings.objectives,
        ctaUrl
      });
      if (generatedCopy.warning) {
        executionWarnings.push(
          `Content generation fallback for ${landing.landingUrl}: ${generatedCopy.warning}`
        );
      }
      const summary = input.context.settings.eeatStructuredSnippetEnabled
        ? generatedCopy.snippet
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
          contentProvider: generatedCopy.provider,
          contentModel: generatedCopy.model,
          contentWarning: generatedCopy.warning ?? null,
          pageContext,
          wordCount: wordCount(generatedCopy.longForm),
          longForm: generatedCopy.longForm
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
