import type { BlitzAction, BlitzRun } from "@trd-aiblitz/domain";
import { GbpApiClient, refreshAccessToken } from "@trd-aiblitz/integrations-gbp";
import { decryptJsonToken, encryptJsonToken } from "../crypto";
import type {
  ActionExecutionResult,
  ActionExecutor,
  BlitzRunRepository,
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

function replyForReview(input: {
  reviewerName: string;
  starRating: number;
  comment: string;
  locationTitle: string;
}): string {
  const name = input.reviewerName.trim() || "there";
  const intro = `Hi ${name}, thank you for your feedback.`;
  if (input.starRating >= 4) {
    return `${intro} We appreciate your ${input.starRating}-star review for ${input.locationTitle}. We look forward to serving you again soon.`;
  }
  if (input.starRating === 3) {
    return `${intro} We appreciate you choosing ${input.locationTitle} and will use your feedback to keep improving.`;
  }
  return `${intro} We're sorry your experience at ${input.locationTitle} did not meet expectations. Please contact our team so we can make this right.`;
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
    if (cached && !this.isTokenExpiring(cached.token, 90)) {
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

    const context: RunContext = {
      connection,
      token,
      client,
      locations: resolved.locations,
      warnings: resolved.warnings
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

    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
    if (!clientId || !clientSecret || !siteUrl) {
      throw new Error("Google OAuth env missing. Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, NEXT_PUBLIC_SITE_URL.");
    }

    const refreshed = await refreshAccessToken(
      {
        clientId,
        clientSecret,
        redirectUri: `${siteUrl}/api/v1/gbp/oauth/callback`
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
    const filteredLocations =
      payloadLocationNames.length > 0
        ? locations.filter((location) => payloadLocationNames.includes(location.locationName))
        : locations;

    return {
      locations: filteredLocations,
      warnings
    };
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
      return {
        objective: input.objective,
        status: "scheduled_metadata_only",
        windows: toStringArray(input.action.payload.windows),
        locationCount: input.context.locations.length
      };
    }

    const postCount = Math.max(
      1,
      Math.min(
        this.options.maxPostBurst,
        toNumber(input.action.payload.postCount, Math.min(input.context.locations.length, 5))
      )
    );
    const mediaUrl = typeof input.action.payload.mediaUrl === "string" ? input.action.payload.mediaUrl : undefined;
    const ctaUrlFromPayload = typeof input.action.payload.ctaUrl === "string" ? input.action.payload.ctaUrl : undefined;
    const publishedPosts: Array<Record<string, unknown>> = [];
    const failed: Array<Record<string, unknown>> = [];

    for (let index = 0; index < postCount; index += 1) {
      const location = input.context.locations[index % input.context.locations.length];
      const summary = buildPostSummary({
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
          ctaUrl: ctaUrlFromPayload ?? location.websiteUri ?? undefined
        });
        publishedPosts.push({
          name: response.name,
          accountId: location.accountId,
          locationId: location.locationId,
          locationName: location.locationName,
          title: location.title
        });
      } catch (error) {
        failed.push({
          accountId: location.accountId,
          locationId: location.locationId,
          locationName: location.locationName,
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
      publishedPosts,
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
        const starRating = parseStarRating(review.starRating);
        const replyText = replyForReview({
          reviewerName: review.reviewer?.displayName ?? "there",
          starRating,
          comment: review.comment ?? "",
          locationTitle: location.title ?? "our business"
        });

        try {
          await input.context.client.postReviewReply(location.accountId, location.locationId, reviewId, replyText);
          replied.push({
            reviewName: review.name,
            reviewId,
            locationName: location.locationName,
            accountId: location.accountId,
            rating: starRating
          });
        } catch (error) {
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
