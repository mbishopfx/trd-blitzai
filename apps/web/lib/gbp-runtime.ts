import { GbpApiClient, generateReviewReply, refreshAccessToken, type GbpReview } from "@trd-aiblitz/integrations-gbp";
import { decryptJson, encryptJson } from "@/lib/crypto";
import { getSupabaseServiceClient, isSupabaseConfigured } from "@/lib/supabase";

interface TokenPayload {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

interface RuntimeContext {
  organizationId: string;
  clientId: string;
  accountName: string;
  accountId: string;
  locationName: string;
  locationId: string;
  locationTitle: string;
  token: TokenPayload;
  client: GbpApiClient;
}

export interface ClientReviewRecord {
  reviewId: string;
  reviewName: string;
  reviewerName: string;
  rating: number;
  starRating: string;
  comment: string;
  createdAt: string | null;
  updatedAt: string | null;
  hasReply: boolean;
  replyComment: string | null;
  replyUpdatedAt: string | null;
}

function parseAccountId(accountName: string): string {
  return accountName.replace(/^accounts\//, "");
}

function parseLocationId(locationName: string): string {
  return locationName.replace(/^locations\//, "");
}

function parseReviewId(review: GbpReview): string {
  if (review.reviewId && review.reviewId.trim()) {
    return review.reviewId;
  }

  const match = review.name?.match(/\/reviews\/([^/]+)$/);
  if (match?.[1]) {
    return match[1];
  }
  return review.name ?? "unknown-review";
}

function parseStarRating(starRating: string | undefined): number {
  if (!starRating) {
    return 0;
  }

  const numeric = Number(starRating);
  if (Number.isFinite(numeric)) {
    return Math.max(0, Math.min(5, Math.floor(numeric)));
  }

  const map: Record<string, number> = {
    ONE: 1,
    TWO: 2,
    THREE: 3,
    FOUR: 4,
    FIVE: 5
  };
  return map[starRating.toUpperCase()] ?? 0;
}

function isExpiringSoon(expiresAt: string, skewSeconds = 120): boolean {
  const expiryMs = new Date(expiresAt).getTime();
  if (Number.isNaN(expiryMs)) {
    return true;
  }

  return expiryMs <= Date.now() + skewSeconds * 1000;
}

function toneAdjustedReply(input: { baseReply: string; style: string }): string {
  const style = input.style.toLowerCase();
  const base = input.baseReply.trim();

  if (style.includes("concise")) {
    return base.split(".").slice(0, 2).join(".").trim().replace(/\.+$/, ".");
  }

  if (style.includes("direct")) {
    return base
      .replace("We appreciate", "Thanks for")
      .replace("We are reviewing this internally and would value a chance to improve your next visit.", "We are already working on this and want to earn your trust.");
  }

  return base;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(String).map((entry) => entry.trim()).filter(Boolean);
}

function normalizeHttpUrl(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const url = new URL(trimmed.startsWith("http://") || trimmed.startsWith("https://") ? trimmed : `https://${trimmed}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function toBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }
  return false;
}

async function resolveRuntimeContext(
  clientId: string,
  options?: { locationName?: string | null; locationId?: string | null; accountName?: string | null }
): Promise<RuntimeContext> {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase credentials are required for live GBP operations");
  }

  const supabase = getSupabaseServiceClient();
  const { data: connectionRow, error: connectionError } = await supabase
    .from("integration_connections")
    .select("id,organization_id,provider_account_id,encrypted_token_payload,metadata,token_expires_at")
    .eq("client_id", clientId)
    .eq("provider", "gbp")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (connectionError) {
    throw new Error(`Failed to load GBP connection: ${connectionError.message}`);
  }
  if (!connectionRow) {
    throw new Error("No active GBP connection found for this client");
  }

  const encryptedPayload = connectionRow.encrypted_token_payload as Record<string, unknown> | null;
  const encryptedTokenBlob = encryptedPayload?.token;
  if (typeof encryptedTokenBlob !== "string" || !encryptedTokenBlob) {
    throw new Error("GBP integration token blob is missing");
  }

  const tokenPayload = decryptJson(encryptedTokenBlob);
  const accessToken = typeof tokenPayload.accessToken === "string" ? tokenPayload.accessToken : "";
  const refreshToken = typeof tokenPayload.refreshToken === "string" ? tokenPayload.refreshToken : "";
  const expiresAtRaw = typeof tokenPayload.expiresAt === "string" ? tokenPayload.expiresAt : null;
  if (!accessToken) {
    throw new Error("GBP integration is missing an access token");
  }

  let token: TokenPayload = {
    accessToken,
    refreshToken,
    expiresAt: expiresAtRaw ?? new Date(Date.now() + 40 * 60 * 1000).toISOString()
  };

  if (isExpiringSoon(token.expiresAt) && token.refreshToken) {
    const oauthClientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
    const oauthClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
    const redirectUri =
      process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() ??
      process.env.NEXT_PUBLIC_SITE_URL?.trim()?.concat("/api/v1/gbp/oauth/callback") ??
      "https://localhost/api/v1/gbp/oauth/callback";
    if (!oauthClientId || !oauthClientSecret) {
      throw new Error("Google OAuth environment variables are not configured for token refresh");
    }

    const refreshed = await refreshAccessToken(
      {
        clientId: oauthClientId,
        clientSecret: oauthClientSecret,
        redirectUri
      },
      token.refreshToken
    );

    token = {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      expiresAt: refreshed.expiresAt
    };

    await supabase
      .from("integration_connections")
      .update({
        encrypted_token_payload: {
          ...(encryptedPayload ?? {}),
          token: encryptJson({
            accessToken: token.accessToken,
            refreshToken: token.refreshToken,
            expiresAt: token.expiresAt
          })
        },
        scopes: refreshed.scopes,
        token_expires_at: token.expiresAt,
        last_refresh_at: new Date().toISOString()
      })
      .eq("id", connectionRow.id);
  }

  const client = new GbpApiClient(token.accessToken);
  const metadata = (connectionRow.metadata as Record<string, unknown> | null) ?? {};

  let locationQuery = supabase
    .from("gbp_locations")
    .select("account_name,account_id,location_name,location_id,title")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (options?.locationName) {
    locationQuery = locationQuery.eq("location_name", options.locationName);
  } else if (options?.locationId) {
    locationQuery = locationQuery.eq("location_id", options.locationId);
  }

  const { data: locationRow } = await locationQuery.maybeSingle();

  let accountName =
    (typeof options?.accountName === "string" && options.accountName.trim() ? options.accountName.trim() : null) ||
    (typeof locationRow?.account_name === "string" && locationRow.account_name) ||
    (typeof connectionRow.provider_account_id === "string" && connectionRow.provider_account_id.startsWith("accounts/")
      ? connectionRow.provider_account_id
      : null) ||
    (typeof metadata.accountName === "string" ? metadata.accountName : null) ||
    "";

  let locationName = (typeof options?.locationName === "string" && options.locationName) || (typeof locationRow?.location_name === "string" && locationRow.location_name) || "";
  let locationTitle = (typeof locationRow?.title === "string" && locationRow.title) || "";
  let locationId = (typeof options?.locationId === "string" && options.locationId) || (typeof locationRow?.location_id === "string" && locationRow.location_id) || "";

  if (!accountName || !locationName) {
    const accounts = await client.listAccounts();
    if (!accounts.length) {
      throw new Error("Connected Google user has no GBP accounts");
    }

    if (!accountName || !accounts.some((a) => a.name === accountName)) {
      accountName = accounts[0].name;
    }

    const locations = await client.listLocations(accountName);
    if (!locations.length) {
      throw new Error(`No locations found for GBP account ${accountName}`);
    }

    const matched =
      (locationName ? locations.find((loc) => loc.name === locationName) : null) ??
      (locationId ? locations.find((loc) => parseLocationId(loc.name) === locationId) : null);
    const selected = matched ?? locations[0];
    locationName = selected.name;
    locationTitle = selected.title ?? locationTitle;
    locationId = parseLocationId(selected.name);
  }

  return {
    organizationId: String(connectionRow.organization_id),
    clientId,
    accountName,
    accountId: (typeof locationRow?.account_id === "string" && locationRow.account_id) || parseAccountId(accountName),
    locationName,
    locationId: locationId || parseLocationId(locationName),
    locationTitle: locationTitle || locationName,
    token,
    client
  };
}

async function upsertReplyHistory(input: {
  organizationId: string;
  clientId: string;
  locationId: string;
  reviewId: string;
  rating: number;
  reviewText: string;
  replyText: string;
  status: "posted" | "failed";
  error?: string;
}): Promise<void> {
  if (!isSupabaseConfigured()) {
    return;
  }

  const supabase = getSupabaseServiceClient();
  await supabase.from("review_reply_history").upsert(
    {
      organization_id: input.organizationId,
      client_id: input.clientId,
      location_id: input.locationId,
      review_id: input.reviewId,
      review_rating: input.rating,
      review_text: input.reviewText,
      reply_text: input.replyText,
      reply_status: input.status,
      replied_at: input.status === "posted" ? new Date().toISOString() : null,
      error: input.error ?? null,
      source_payload: {
        source: "blitz_web_reviews",
        updatedAt: new Date().toISOString()
      }
    },
    {
      onConflict: "client_id,review_id"
    }
  );
}

async function hasPostedReplyHistory(clientId: string, reviewId: string): Promise<boolean> {
  if (!isSupabaseConfigured()) {
    return false;
  }

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("review_reply_history")
    .select("id")
    .eq("client_id", clientId)
    .eq("review_id", reviewId)
    .eq("reply_status", "posted")
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to check review reply history: ${error.message}`);
  }

  return Boolean(data);
}

export async function listClientGbpReviews(clientId: string, limit = 100): Promise<{
  location: { accountName: string; locationName: string; locationTitle: string };
  reviews: ClientReviewRecord[];
}> {
  const runtime = await resolveRuntimeContext(clientId);
  const reviews = await runtime.client.fetchReviews(runtime.accountId, runtime.locationId);

  const normalized = reviews
    .map<ClientReviewRecord>((review) => {
      const rating = parseStarRating(review.starRating);
      return {
        reviewId: parseReviewId(review),
        reviewName: review.name,
        reviewerName: review.reviewer?.displayName ?? "Anonymous",
        rating,
        starRating: review.starRating ?? String(rating || ""),
        comment: review.comment ?? "",
        createdAt: review.createTime ?? null,
        updatedAt: review.updateTime ?? null,
        hasReply: Boolean(review.reviewReply?.comment),
        replyComment: review.reviewReply?.comment ?? null,
        replyUpdatedAt: review.reviewReply?.updateTime ?? null
      };
    })
    .sort((a, b) => {
      const left = new Date(b.updatedAt ?? b.createdAt ?? 0).getTime();
      const right = new Date(a.updatedAt ?? a.createdAt ?? 0).getTime();
      return left - right;
    })
    .slice(0, Math.max(1, Math.min(limit, 250)));

  return {
    location: {
      accountName: runtime.accountName,
      locationName: runtime.locationName,
      locationTitle: runtime.locationTitle
    },
    reviews: normalized
  };
}

export async function postClientReviewReply(input: {
  clientId: string;
  reviewId: string;
  comment: string;
}): Promise<{ reviewId: string; postedAt: string }> {
  const runtime = await resolveRuntimeContext(input.clientId);
  const reviews = await runtime.client.fetchReviews(runtime.accountId, runtime.locationId);
  const targetReview = reviews.find((review) => parseReviewId(review) === input.reviewId);

  if (!targetReview) {
    throw new Error(`Review ${input.reviewId} was not found in the latest GBP review feed`);
  }

  if (targetReview?.reviewReply?.comment) {
    throw new Error(`Review ${input.reviewId} already has a reply on GBP`);
  }

  if (await hasPostedReplyHistory(runtime.clientId, input.reviewId)) {
    throw new Error(`Review ${input.reviewId} already has a posted reply in Blitz history`);
  }

  const postedAt = new Date().toISOString();

  await runtime.client.postReviewReply(runtime.accountId, runtime.locationId, targetReview.name, input.comment);

  await upsertReplyHistory({
    organizationId: runtime.organizationId,
    clientId: runtime.clientId,
    locationId: runtime.locationId,
    reviewId: input.reviewId,
    rating: 0,
    reviewText: "",
    replyText: input.comment,
    status: "posted"
  });

  return {
    reviewId: input.reviewId,
    postedAt
  };
}

export async function autoReplyClientReviews(input: {
  clientId: string;
  tone: string;
  reviewReplyStyle: string;
  limit?: number;
}): Promise<{
  attempted: number;
  posted: number;
  skipped: number;
  failed: number;
}> {
  const runtime = await resolveRuntimeContext(input.clientId);
  const reviews = await runtime.client.fetchReviews(runtime.accountId, runtime.locationId);

  const max = Math.max(1, Math.min(input.limit ?? 50, 250));
  let attempted = 0;
  let posted = 0;
  let skipped = 0;
  let failed = 0;

  for (const review of reviews.slice(0, max)) {
    const reviewId = parseReviewId(review);
    const rating = parseStarRating(review.starRating);
    const reviewText = review.comment ?? "";

    if (review.reviewReply?.comment) {
      skipped += 1;
      continue;
    }

    if (await hasPostedReplyHistory(runtime.clientId, reviewId)) {
      skipped += 1;
      continue;
    }

    attempted += 1;
    const generated = generateReviewReply({
      review,
      businessName: runtime.locationTitle,
      brandVoice: input.tone
    });
    const finalReply = toneAdjustedReply({
      baseReply: generated,
      style: input.reviewReplyStyle
    });

    try {
      await runtime.client.postReviewReply(runtime.accountId, runtime.locationId, review.name, finalReply);
      posted += 1;
      await upsertReplyHistory({
        organizationId: runtime.organizationId,
        clientId: runtime.clientId,
        locationId: runtime.locationId,
        reviewId,
        rating,
        reviewText,
        replyText: finalReply,
        status: "posted"
      });
    } catch (error) {
      failed += 1;
      await upsertReplyHistory({
        organizationId: runtime.organizationId,
        clientId: runtime.clientId,
        locationId: runtime.locationId,
        reviewId,
        rating,
        reviewText,
        replyText: finalReply,
        status: "failed",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return {
    attempted,
    posted,
    skipped,
    failed
  };
}

export type GbpExecutionOperation =
  | {
      kind: "patch_location";
      patch: Record<string, unknown>;
      updateMask: string[];
    }
  | {
      kind: "update_attributes";
      attributes: Array<Record<string, unknown>>;
      attributeMask: string[];
    }
  | {
      kind: "upsert_place_action_links";
      links: Array<Record<string, unknown>>;
    };

async function executeGbpOperation(input: {
  runtime: RuntimeContext;
  operation: GbpExecutionOperation;
}): Promise<Record<string, unknown>> {
  if (input.operation.kind === "patch_location") {
    const dedupedMask = [...new Set(input.operation.updateMask.map((entry) => entry.trim()).filter(Boolean))];
    if (!dedupedMask.length) {
      throw new Error("patch_location requires updateMask");
    }
    if (!input.operation.patch || typeof input.operation.patch !== "object" || Array.isArray(input.operation.patch)) {
      throw new Error("patch_location requires patch object");
    }
    await input.runtime.client.patchLocation(input.runtime.locationName, input.operation.patch, dedupedMask);
    return {
      kind: "patch_location",
      updateMask: dedupedMask
    };
  }

  if (input.operation.kind === "update_attributes") {
    const attributeMask = [...new Set(input.operation.attributeMask.map((entry) => entry.trim()).filter(Boolean))];
    if (!attributeMask.length) {
      throw new Error("update_attributes requires attributeMask");
    }
    const attributes = input.operation.attributes
      .map((entry) => asRecord(entry))
      .filter((entry) => Object.keys(entry).length > 0);
    if (!attributes.length) {
      throw new Error("update_attributes requires at least one attribute object");
    }

    await input.runtime.client.updateLocationAttributes({
      locationName: input.runtime.locationName,
      attributes,
      attributeMask
    });
    return {
      kind: "update_attributes",
      attributeMask,
      updatedCount: attributes.length
    };
  }

  const existingLinks = await input.runtime.client.listPlaceActionLinks(input.runtime.locationId);
  const byKey = new Map<string, { name?: string }>();
  for (const link of existingLinks) {
    const uri = normalizeHttpUrl(typeof link.uri === "string" ? link.uri : null);
    const placeActionType = typeof link.placeActionType === "string" ? link.placeActionType.toUpperCase() : null;
    if (!uri || !placeActionType) {
      continue;
    }
    byKey.set(`${placeActionType}|${uri}`, {
      name: typeof link.name === "string" ? link.name : undefined
    });
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const rawLink of input.operation.links) {
    const record = asRecord(rawLink);
    const uri = normalizeHttpUrl(typeof record.uri === "string" ? record.uri : null);
    const placeActionType = typeof record.placeActionType === "string" ? record.placeActionType.toUpperCase() : "SHOP_ONLINE";
    const isPreferred = toBoolean(record.isPreferred);
    if (!uri) {
      skipped += 1;
      continue;
    }

    const key = `${placeActionType}|${uri}`;
    const existing = byKey.get(key);
    if (existing?.name) {
      await input.runtime.client.patchPlaceActionLink(
        existing.name,
        {
          uri,
          placeActionType,
          isPreferred
        },
        ["uri", "placeActionType", "isPreferred"]
      );
      updated += 1;
      continue;
    }

    await input.runtime.client.createPlaceActionLink(input.runtime.locationId, {
      uri,
      placeActionType,
      isPreferred
    });
    created += 1;
  }

  return {
    kind: "upsert_place_action_links",
    requested: input.operation.links.length,
    created,
    updated,
    skipped
  };
}

export async function executeClientGbpOperations(input: {
  clientId: string;
  locationName?: string | null;
  locationId?: string | null;
  accountName?: string | null;
  operations: GbpExecutionOperation[];
}): Promise<{
  location: { accountName: string; accountId: string; locationName: string; locationId: string; locationTitle: string };
  operations: Array<Record<string, unknown>>;
  executedAt: string;
}> {
  if (!Array.isArray(input.operations) || input.operations.length === 0) {
    throw new Error("operations are required for GBP execution");
  }

  const runtime = await resolveRuntimeContext(input.clientId, {
    locationName: input.locationName,
    locationId: input.locationId,
    accountName: input.accountName
  });

  const operationResults: Array<Record<string, unknown>> = [];
  for (const operation of input.operations) {
    operationResults.push(
      await executeGbpOperation({
        runtime,
        operation
      })
    );
  }

  return {
    location: {
      accountName: runtime.accountName,
      accountId: runtime.accountId,
      locationName: runtime.locationName,
      locationId: runtime.locationId,
      locationTitle: runtime.locationTitle
    },
    operations: operationResults,
    executedAt: new Date().toISOString()
  };
}

export async function applyClientGbpPatch(input: {
  clientId: string;
  locationName?: string | null;
  locationId?: string | null;
  accountName?: string | null;
  patch: Record<string, unknown>;
  updateMask: string[];
}): Promise<{
  location: { accountName: string; accountId: string; locationName: string; locationId: string; locationTitle: string };
  updateMask: string[];
  executedAt: string;
}> {
  const execution = await executeClientGbpOperations({
    clientId: input.clientId,
    accountName: input.accountName,
    locationName: input.locationName,
    locationId: input.locationId,
    operations: [
      {
        kind: "patch_location",
        patch: input.patch,
        updateMask: input.updateMask
      }
    ]
  });

  return {
    location: execution.location,
    updateMask: [...new Set(input.updateMask.map((entry) => entry.trim()).filter(Boolean))],
    executedAt: execution.executedAt
  };
}
