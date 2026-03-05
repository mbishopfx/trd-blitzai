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

async function resolveRuntimeContext(clientId: string): Promise<RuntimeContext> {
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
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
    if (!oauthClientId || !oauthClientSecret || !siteUrl) {
      throw new Error("Google OAuth environment variables are not configured for token refresh");
    }

    const refreshed = await refreshAccessToken(
      {
        clientId: oauthClientId,
        clientSecret: oauthClientSecret,
        redirectUri: `${siteUrl}/api/v1/gbp/oauth/callback`
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

  const { data: locationRow } = await supabase
    .from("gbp_locations")
    .select("account_name,account_id,location_name,location_id,title")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let accountName =
    (typeof locationRow?.account_name === "string" && locationRow.account_name) ||
    (typeof connectionRow.provider_account_id === "string" && connectionRow.provider_account_id.startsWith("accounts/")
      ? connectionRow.provider_account_id
      : null) ||
    (typeof metadata.accountName === "string" ? metadata.accountName : null) ||
    "";

  let locationName = (typeof locationRow?.location_name === "string" && locationRow.location_name) || "";
  let locationTitle = (typeof locationRow?.title === "string" && locationRow.title) || "";

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

    const matched = locationName ? locations.find((loc) => loc.name === locationName) : null;
    const selected = matched ?? locations[0];
    locationName = selected.name;
    locationTitle = selected.title ?? locationTitle;
  }

  return {
    organizationId: String(connectionRow.organization_id),
    clientId,
    accountName,
    accountId: (typeof locationRow?.account_id === "string" && locationRow.account_id) || parseAccountId(accountName),
    locationName,
    locationId: (typeof locationRow?.location_id === "string" && locationRow.location_id) || parseLocationId(locationName),
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
  const postedAt = new Date().toISOString();

  await runtime.client.postReviewReply(runtime.accountId, runtime.locationId, input.reviewId, input.comment);

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
      await runtime.client.postReviewReply(runtime.accountId, runtime.locationId, reviewId, finalReply);
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
