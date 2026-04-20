import pino from "pino";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GbpApiClient, refreshAccessToken, type GbpReview } from "@trd-aiblitz/integrations-gbp";
import { decryptJsonToken, encryptJsonToken } from "./crypto";

const logger = pino({ name: "aiblitz-review-alert-refresh" });

interface GbpConnectionRow {
  id: string;
  organization_id: string;
  client_id: string;
  provider_account_id: string;
  encrypted_token_payload: Record<string, unknown> | null;
  scopes: string[] | null;
  token_expires_at: string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string | null;
}

interface GbpLocationRow {
  client_id: string;
  account_name: string | null;
  account_id: string | null;
  location_name: string;
  location_id: string | null;
  title: string | null;
}

interface PendingAlertRow {
  id: string;
  fingerprint: string | null;
  payload: Record<string, unknown> | null;
}

interface TokenPayload {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

export interface ReviewAlertRefreshWorker {
  close(): Promise<void>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseAccountId(accountName: string): string {
  return accountName.replace(/^accounts\//, "");
}

function parseLocationId(locationName: string): string {
  return locationName.replace(/^locations\//, "");
}

function parseReviewId(review: GbpReview): string {
  if (typeof review.reviewId === "string" && review.reviewId.trim()) {
    return review.reviewId.trim();
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

function isTokenExpiring(expiresAt: string, skewSeconds = 120): boolean {
  const expiryMs = new Date(expiresAt).getTime();
  if (Number.isNaN(expiryMs)) {
    return true;
  }
  return expiryMs <= Date.now() + skewSeconds * 1000;
}

function normalizeText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function createFingerprint(locationId: string, reviewId: string): string {
  return `gbp-review-alert:${locationId}:${reviewId}`;
}

function alertTitle(reviewerName: string, rating: number): string {
  const name = reviewerName || "Customer";
  return rating > 0 ? `Reply needed: ${rating}-star review from ${name}` : `Reply needed: new review from ${name}`;
}

function alertDescription(input: { locationTitle: string; reviewerName: string; comment: string; rating: number }): string {
  const locationLabel = input.locationTitle || "this GBP location";
  const reviewerName = input.reviewerName || "A customer";
  const ratingLabel = input.rating > 0 ? `${input.rating}-star` : "new";
  const snippet = normalizeText(input.comment);
  const suffix = snippet ? ` Latest comment: "${snippet.slice(0, 180)}${snippet.length > 180 ? "..." : ""}"` : "";
  return `${reviewerName} left a ${ratingLabel} review on ${locationLabel} and it still does not have a GBP reply.${suffix}`;
}

async function ensureFreshToken(supabase: SupabaseClient, connection: GbpConnectionRow): Promise<TokenPayload> {
  const tokenBlob = connection.encrypted_token_payload?.token;
  if (typeof tokenBlob !== "string" || !tokenBlob.trim()) {
    throw new Error("GBP integration token payload is missing encrypted token blob.");
  }

  const decrypted = decryptJsonToken(tokenBlob);
  const accessToken = typeof decrypted.accessToken === "string" ? decrypted.accessToken : "";
  const refreshToken = typeof decrypted.refreshToken === "string" ? decrypted.refreshToken : "";
  const expiresAt =
    typeof decrypted.expiresAt === "string" && decrypted.expiresAt
      ? decrypted.expiresAt
      : connection.token_expires_at ?? new Date(Date.now() + 45 * 60 * 1000).toISOString();

  if (!accessToken) {
    throw new Error("GBP integration token payload is missing access token.");
  }

  if (!isTokenExpiring(expiresAt)) {
    return { accessToken, refreshToken, expiresAt };
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

  const { error } = await supabase
    .from("integration_connections")
    .update({
      encrypted_token_payload: {
        ...(connection.encrypted_token_payload ?? {}),
        token: encryptJsonToken({
          accessToken: nextToken.accessToken,
          refreshToken: nextToken.refreshToken,
          expiresAt: nextToken.expiresAt
        })
      },
      scopes: refreshed.scopes.length ? refreshed.scopes : connection.scopes ?? [],
      token_expires_at: nextToken.expiresAt,
      last_refresh_at: nowIso()
    })
    .eq("id", connection.id);
  if (error) {
    throw new Error(`Failed to refresh GBP token cache: ${error.message}`);
  }

  return nextToken;
}

async function refreshClientReviewAlerts(input: {
  supabase: SupabaseClient;
  connection: GbpConnectionRow;
  locations: GbpLocationRow[];
}): Promise<void> {
  const token = await ensureFreshToken(input.supabase, input.connection);
  const client = new GbpApiClient(token.accessToken);

  const { data: pendingRows, error: pendingError } = await input.supabase
    .from("client_actions_needed")
    .select("id,fingerprint,payload")
    .eq("client_id", input.connection.client_id)
    .eq("status", "pending")
    .eq("action_type", "review_reply");
  if (pendingError) {
    throw new Error(`Failed to load pending review alerts: ${pendingError.message}`);
  }

  const pendingByFingerprint = new Map(
    (pendingRows ?? []).map((row) => [typeof row.fingerprint === "string" ? row.fingerprint : "", row as PendingAlertRow])
  );

  const scannedLocationIds = new Set<string>();
  const unrepliedFingerprints = new Set<string>();

  for (const location of input.locations) {
    const accountId = location.account_id?.trim() || (location.account_name ? parseAccountId(location.account_name) : "");
    const locationId = location.location_id?.trim() || parseLocationId(location.location_name);
    if (!accountId || !locationId) {
      logger.warn({ clientId: input.connection.client_id, locationName: location.location_name }, "skipping GBP location with missing identifiers");
      continue;
    }

    const reviews = await client.fetchReviews(accountId, locationId);
    scannedLocationIds.add(locationId);

    for (const review of reviews) {
      if (review.reviewReply?.comment) {
        continue;
      }

      const reviewId = parseReviewId(review);
      const reviewerName = review.reviewer?.displayName?.trim() || "Customer";
      const rating = parseStarRating(review.starRating);
      const fingerprint = createFingerprint(locationId, reviewId);
      unrepliedFingerprints.add(fingerprint);

      if (pendingByFingerprint.has(fingerprint)) {
        continue;
      }

      const { error: insertError } = await input.supabase.from("client_actions_needed").insert({
        organization_id: input.connection.organization_id,
        client_id: input.connection.client_id,
        run_id: null,
        source_action_id: null,
        provider: "gbp",
        location_name: location.location_name,
        location_id: locationId,
        action_type: "review_reply",
        risk_tier: rating <= 2 && rating > 0 ? "critical" : rating === 3 ? "high" : "medium",
        title: alertTitle(reviewerName, rating),
        description: alertDescription({
          locationTitle: location.title ?? location.location_name,
          reviewerName,
          comment: review.comment ?? "",
          rating
        }),
        status: "pending",
        fingerprint,
        payload: {
          source: "review-alert-refresh",
          reviewName: review.name,
          reviewId,
          reviewerName,
          reviewText: review.comment ?? "",
          rating,
          starRating: review.starRating ?? null,
          createdAt: review.createTime ?? null,
          updatedAt: review.updateTime ?? null,
          locationName: location.location_name,
          locationId,
          locationTitle: location.title ?? null,
          accountId
        },
        result: {}
      });
      if (insertError) {
        throw new Error(`Failed to create review alert for ${reviewId}: ${insertError.message}`);
      }
    }
  }

  for (const pending of pendingByFingerprint.values()) {
    if (!pending.fingerprint || unrepliedFingerprints.has(pending.fingerprint)) {
      continue;
    }

    const payloadLocationId =
      typeof pending.payload?.locationId === "string" && pending.payload.locationId.trim()
        ? pending.payload.locationId.trim()
        : pending.fingerprint.split(":")[1] ?? "";
    if (!payloadLocationId || !scannedLocationIds.has(payloadLocationId)) {
      continue;
    }

    const { error: resolveError } = await input.supabase
      .from("client_actions_needed")
      .update({
        status: "manual_completed",
        result: {
          source: "review-alert-refresh",
          resolvedBecause: "reply_detected_on_gbp",
          resolvedAt: nowIso()
        },
        executed_at: nowIso()
      })
      .eq("id", pending.id)
      .eq("status", "pending");
    if (resolveError) {
      throw new Error(`Failed to resolve review alert ${pending.id}: ${resolveError.message}`);
    }
  }
}

async function runRefresh(supabase: SupabaseClient, batchSize: number): Promise<void> {
  const { data: connectionRows, error: connectionError } = await supabase
    .from("integration_connections")
    .select(
      "id,organization_id,client_id,provider_account_id,encrypted_token_payload,scopes,token_expires_at,metadata,updated_at"
    )
    .eq("provider", "gbp")
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(Math.max(1, batchSize));
  if (connectionError) {
    throw new Error(`Failed to load GBP integrations for review alert refresh: ${connectionError.message}`);
  }

  const connectionsByClient = new Map<string, GbpConnectionRow>();
  for (const row of (connectionRows ?? []) as GbpConnectionRow[]) {
    if (!connectionsByClient.has(row.client_id)) {
      connectionsByClient.set(row.client_id, row);
    }
  }

  const clientIds = [...connectionsByClient.keys()];
  if (!clientIds.length) {
    return;
  }

  const { data: locationRows, error: locationError } = await supabase
    .from("gbp_locations")
    .select("client_id,account_name,account_id,location_name,location_id,title")
    .in("client_id", clientIds)
    .order("created_at", { ascending: false });
  if (locationError) {
    throw new Error(`Failed to load GBP locations for review alert refresh: ${locationError.message}`);
  }

  const locationsByClient = new Map<string, GbpLocationRow[]>();
  for (const row of (locationRows ?? []) as GbpLocationRow[]) {
    const current = locationsByClient.get(row.client_id) ?? [];
    current.push(row);
    locationsByClient.set(row.client_id, current);
  }

  for (const [clientId, connection] of connectionsByClient.entries()) {
    const locations = locationsByClient.get(clientId) ?? [];
    if (!locations.length) {
      logger.warn({ clientId }, "skipping review alert refresh for client with no synced GBP locations");
      continue;
    }

    try {
      await refreshClientReviewAlerts({
        supabase,
        connection,
        locations
      });
    } catch (error) {
      logger.error(
        {
          clientId,
          error: error instanceof Error ? error.message : String(error)
        },
        "review alert refresh failed for client"
      );
    }
  }
}

export function startReviewAlertRefreshWorker(input: {
  supabase: SupabaseClient;
  intervalMs?: number;
  batchSize?: number;
}): ReviewAlertRefreshWorker {
  const intervalMs = Math.max(60_000, input.intervalMs ?? 30 * 60 * 1000);
  const batchSize = Math.max(1, input.batchSize ?? 500);
  let timer: NodeJS.Timeout | null = null;
  let running = false;

  const tick = async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      await runRefresh(input.supabase, batchSize);
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, "review alert refresh tick failed");
    } finally {
      running = false;
    }
  };

  void tick();
  timer = setInterval(() => {
    void tick();
  }, intervalMs);

  return {
    async close() {
      if (timer) {
        clearInterval(timer);
      }
    }
  };
}
