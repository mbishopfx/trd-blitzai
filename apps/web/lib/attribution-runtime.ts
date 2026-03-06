import { decryptJson, encryptJson } from "@/lib/crypto";
import { refreshGoogleAccessToken } from "@/lib/google-oauth";
import {
  getClientById,
  listClientIntegrations,
  replaceAttributionRange,
  updateIntegrationConnection,
  type IntegrationConnection
} from "@/lib/control-plane-store";
import { getSupabaseServiceClient, isSupabaseConfigured } from "@/lib/supabase";

interface DailyMetricRow {
  organizationId: string;
  clientId: string;
  locationId: string | null;
  date: string;
  channel: "gbp" | "ga4" | "google_ads" | "search_console";
  impressions: number;
  clicks: number;
  calls: number;
  directions: number;
  conversions: number;
  spend: number;
  conversionValue: number;
  sourcePayload: Record<string, unknown>;
}

interface SyncSummary {
  dateFrom: string;
  dateTo: string;
  channels: Array<"gbp" | "ga4" | "google_ads" | "search_console">;
  rowCount: number;
  providerBreakdown: Record<string, number>;
}

interface GbpLocationMetricSource {
  locationId: string;
  locationName: string;
}

function numberValue(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toDateParts(date: Date): { year: string; month: string; day: string } {
  return {
    year: String(date.getUTCFullYear()),
    month: String(date.getUTCMonth() + 1),
    day: String(date.getUTCDate())
  };
}

function daysForWindow(window: "7d" | "30d" | "90d"): number {
  if (window === "7d") {
    return 7;
  }
  if (window === "90d") {
    return 90;
  }
  return 30;
}

function isTokenExpiring(expiresAt: string | null | undefined, skewSeconds = 300): boolean {
  if (!expiresAt) {
    return false;
  }
  const expiresMs = new Date(expiresAt).getTime();
  if (Number.isNaN(expiresMs)) {
    return true;
  }
  return expiresMs <= Date.now() + skewSeconds * 1000;
}

async function ensureFreshOAuthToken(connection: IntegrationConnection): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: string | null;
}> {
  const tokenBlob = connection.encryptedTokenPayload?.token;
  if (typeof tokenBlob !== "string" || !tokenBlob.trim()) {
    throw new Error(`Connection ${connection.id} is missing token payload`);
  }

  const parsed = decryptJson(tokenBlob);
  const accessToken = typeof parsed.accessToken === "string" ? parsed.accessToken : "";
  const refreshToken = typeof parsed.refreshToken === "string" ? parsed.refreshToken : "";
  const expiresAt = typeof parsed.expiresAt === "string" ? parsed.expiresAt : connection.tokenExpiresAt;

  if (!accessToken) {
    throw new Error(`Connection ${connection.id} does not have an access token`);
  }

  if (!isTokenExpiring(expiresAt) || !refreshToken) {
    return { accessToken, refreshToken, expiresAt: expiresAt ?? null };
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth env missing. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET.");
  }

  const refreshed = await refreshGoogleAccessToken({
    clientId,
    clientSecret,
    refreshToken
  });

  await updateIntegrationConnection(connection.id, {
    encryptedTokenPayload: {
      ...connection.encryptedTokenPayload,
      token: encryptJson({
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: refreshed.expiresAt
      })
    },
    scopes: refreshed.scopes.length ? refreshed.scopes : connection.scopes,
    tokenExpiresAt: refreshed.expiresAt,
    lastRefreshAt: new Date().toISOString()
  });

  return {
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    expiresAt: refreshed.expiresAt
  };
}

async function fetchGbpLocations(clientId: string): Promise<GbpLocationMetricSource[]> {
  if (!isSupabaseConfigured()) {
    return [];
  }
  const { data, error } = await getSupabaseServiceClient()
    .from("gbp_locations")
    .select("location_id,location_name")
    .eq("client_id", clientId)
    .order("created_at", { ascending: true });
  if (error) {
    throw new Error(`Failed to load GBP locations for attribution: ${error.message}`);
  }
  return (data ?? []).map((row) => ({
    locationId: String(row.location_id),
    locationName: String(row.location_name)
  }));
}

function mergeGbpSeries(
  dateFrom: string,
  dateTo: string,
  locationId: string,
  metricSeries: Array<{
    dailyMetric: string;
    timeSeries?: {
      datedValues?: Array<{ date?: { year?: number; month?: number; day?: number }; value?: string | number }>;
    };
  }>
): DailyMetricRow[] {
  const byDate = new Map<string, DailyMetricRow>();
  const start = new Date(`${dateFrom}T00:00:00.000Z`);
  const end = new Date(`${dateTo}T00:00:00.000Z`);

  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const key = cursor.toISOString().slice(0, 10);
    byDate.set(key, {
      organizationId: "",
      clientId: "",
      locationId,
      date: key,
      channel: "gbp",
      impressions: 0,
      clicks: 0,
      calls: 0,
      directions: 0,
      conversions: 0,
      spend: 0,
      conversionValue: 0,
      sourcePayload: {}
    });
  }

  for (const series of metricSeries) {
    const datedValues = Array.isArray(series.timeSeries?.datedValues) ? series.timeSeries?.datedValues : [];
    for (const datedValue of datedValues) {
      const rawDate = datedValue.date;
      const year = rawDate?.year;
      const month = rawDate?.month;
      const day = rawDate?.day;
      if (!year || !month || !day) {
        continue;
      }
      const date = new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
      const row = byDate.get(date);
      if (!row) {
        continue;
      }
      const value = numberValue(datedValue.value);
      switch (series.dailyMetric) {
        case "WEBSITE_CLICKS":
          row.clicks += value;
          break;
        case "CALL_CLICKS":
          row.calls += value;
          break;
        case "BUSINESS_DIRECTION_REQUESTS":
          row.directions += value;
          break;
        case "BUSINESS_IMPRESSIONS_DESKTOP_MAPS":
        case "BUSINESS_IMPRESSIONS_MOBILE_MAPS":
        case "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH":
        case "BUSINESS_IMPRESSIONS_MOBILE_SEARCH":
          row.impressions += value;
          break;
        default:
          break;
      }
      row.conversions = row.calls + row.directions;
      row.sourcePayload = {
        ...(row.sourcePayload ?? {}),
        [series.dailyMetric]: value
      };
    }
  }

  return [...byDate.values()];
}

async function fetchGbpDailyMetrics(input: {
  clientId: string;
  organizationId: string;
  connection: IntegrationConnection;
  dateFrom: string;
  dateTo: string;
}): Promise<DailyMetricRow[]> {
  const locations = await fetchGbpLocations(input.clientId);
  if (!locations.length) {
    return [];
  }

  const token = await ensureFreshOAuthToken(input.connection);
  const metrics = [
    "WEBSITE_CLICKS",
    "CALL_CLICKS",
    "BUSINESS_DIRECTION_REQUESTS",
    "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
    "BUSINESS_IMPRESSIONS_MOBILE_MAPS"
  ];
  const rows: DailyMetricRow[] = [];

  for (const location of locations) {
    const endpoint = new URL(
      `https://businessprofileperformance.googleapis.com/v1/${location.locationName}:fetchMultiDailyMetricsTimeSeries`
    );
    for (const metric of metrics) {
      endpoint.searchParams.append("dailyMetrics", metric);
    }
    const start = toDateParts(new Date(`${input.dateFrom}T00:00:00.000Z`));
    const end = toDateParts(new Date(`${input.dateTo}T00:00:00.000Z`));
    endpoint.searchParams.set("dailyRange.start_date.year", start.year);
    endpoint.searchParams.set("dailyRange.start_date.month", start.month);
    endpoint.searchParams.set("dailyRange.start_date.day", start.day);
    endpoint.searchParams.set("dailyRange.end_date.year", end.year);
    endpoint.searchParams.set("dailyRange.end_date.month", end.month);
    endpoint.searchParams.set("dailyRange.end_date.day", end.day);

    const response = await fetch(endpoint.toString(), {
      headers: {
        Authorization: `Bearer ${token.accessToken}`
      }
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`GBP performance sync failed (${response.status}): ${body.slice(0, 280)}`);
    }

    const payload = (await response.json()) as {
      multiDailyMetricTimeSeries?: Array<{
        dailyMetric: string;
        timeSeries?: {
          datedValues?: Array<{ date?: { year?: number; month?: number; day?: number }; value?: string | number }>;
        };
      }>;
    };

    rows.push(
      ...mergeGbpSeries(input.dateFrom, input.dateTo, location.locationId, payload.multiDailyMetricTimeSeries ?? []).map(
        (row) => ({
          ...row,
          organizationId: input.organizationId,
          clientId: input.clientId
        })
      )
    );
  }

  return rows;
}

async function callWorkerPyAttributionSync(payload: Record<string, unknown>): Promise<DailyMetricRow[]> {
  const baseUrl = process.env.WORKER_PY_URL?.trim() ?? process.env.RAILWAY_WORKER_PY_URL?.trim();
  if (!baseUrl) {
    return [];
  }

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/attribution/sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`worker-py attribution sync failed (${response.status}): ${body.slice(0, 280)}`);
  }
  const data = (await response.json()) as { rows?: Array<Record<string, unknown>> };
  return (data.rows ?? []).map((row) => ({
    organizationId: String(row.organization_id),
    clientId: String(row.client_id),
    locationId: typeof row.location_id === "string" ? row.location_id : null,
    date: String(row.date),
    channel: String(row.channel) as DailyMetricRow["channel"],
    impressions: numberValue(row.impressions),
    clicks: numberValue(row.clicks),
    calls: numberValue(row.calls),
    directions: numberValue(row.directions),
    conversions: numberValue(row.conversions),
    spend: numberValue(row.spend),
    conversionValue: numberValue(row.conversion_value),
    sourcePayload: (row.source_payload as Record<string, unknown> | null) ?? {}
  }));
}

export async function syncClientAttribution(input: {
  clientId: string;
  window?: "7d" | "30d" | "90d";
}): Promise<SyncSummary> {
  const client = await getClientById(input.clientId);
  if (!client) {
    throw new Error("Client not found");
  }

  const window = input.window ?? "30d";
  const dateTo = new Date();
  const dateFrom = new Date();
  dateFrom.setUTCDate(dateFrom.getUTCDate() - (daysForWindow(window) - 1));
  const dateFromIso = dateFrom.toISOString().slice(0, 10);
  const dateToIso = dateTo.toISOString().slice(0, 10);

  const integrations = await listClientIntegrations(input.clientId);
  const integrationByProvider = new Map(integrations.map((connection) => [connection.provider, connection]));

  const gbpConnection = integrationByProvider.get("gbp") ?? null;
  const ga4Connection = integrationByProvider.get("ga4") ?? null;
  const adsConnection = integrationByProvider.get("google_ads") ?? null;
  const searchConsoleConnection = integrationByProvider.get("search_console") ?? null;

  const pyPayload: Record<string, unknown> = {
    organization_id: client.organizationId,
    client_id: client.id,
    date_from: dateFromIso,
    date_to: dateToIso
  };

  if (ga4Connection) {
    const token = await ensureFreshOAuthToken(ga4Connection);
    pyPayload.ga4 = {
      access_token: token.accessToken,
      property_id:
        ga4Connection.providerAccountId.replace(/^properties\//, "") ||
        String(asRecord(ga4Connection.metadata).property_id ?? "")
    };
  }

  if (adsConnection) {
    const tokenBlob = adsConnection.encryptedTokenPayload?.token;
    const tokenPayload = typeof tokenBlob === "string" ? decryptJson(tokenBlob) : {};
    pyPayload.google_ads = {
      customer_id: adsConnection.providerAccountId.replace(/-/g, ""),
      connection: {
        developer_token:
          String(asRecord(adsConnection.metadata).developer_token ?? process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? ""),
        refresh_token: String(tokenPayload.refreshToken ?? ""),
        login_customer_id: String(
          asRecord(adsConnection.metadata).login_customer_id ?? process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? ""
        ),
        oauth_client_secrets_json: {
          web: {
            client_id: process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() ?? "",
            client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() ?? "",
            auth_uri: "https://accounts.google.com/o/oauth2/auth",
            token_uri: "https://oauth2.googleapis.com/token"
          }
        }
      }
    };
  }

  if (searchConsoleConnection) {
    const token = await ensureFreshOAuthToken(searchConsoleConnection);
    pyPayload.search_console = {
      access_token: token.accessToken,
      property_url:
        searchConsoleConnection.providerAccountId ||
        String(asRecord(searchConsoleConnection.metadata).property_url ?? client.websiteUrl ?? "")
    };
  }

  const [pythonRows, gbpRows] = await Promise.all([
    callWorkerPyAttributionSync(pyPayload),
    gbpConnection
      ? fetchGbpDailyMetrics({
          clientId: client.id,
          organizationId: client.organizationId,
          connection: gbpConnection,
          dateFrom: dateFromIso,
          dateTo: dateToIso
        })
      : Promise.resolve([])
  ]);

  const rows = [...pythonRows, ...gbpRows];
  const channels = [...new Set(rows.map((row) => row.channel))];
  if (!channels.length) {
    throw new Error("No active attribution integrations are configured for this client");
  }

  await replaceAttributionRange({
    clientId: client.id,
    organizationId: client.organizationId,
    dateFrom: dateFromIso,
    dateTo: dateToIso,
    channels,
    rows
  });

  const providerBreakdown = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.channel] = (acc[row.channel] ?? 0) + 1;
    return acc;
  }, {});

  return {
    dateFrom: dateFromIso,
    dateTo: dateToIso,
    channels,
    rowCount: rows.length,
    providerBreakdown
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}
