import type {
  DailyChannelMetric,
  Ga4MetricRow,
  GbpNativeMetricRow,
  GoogleAdsMetricRow,
  SearchConsoleMetricRow
} from "./contracts";

interface BaseIdentity {
  organizationId: string;
  clientId: string;
  locationId: string | null;
}

export function mapGbpMetrics(identity: BaseIdentity, rows: GbpNativeMetricRow[]): DailyChannelMetric[] {
  return rows.map((row) => ({
    ...identity,
    date: row.date,
    channel: "gbp",
    impressions: row.impressions,
    clicks: row.websiteClicks,
    calls: row.calls,
    directions: row.directions,
    conversions: row.calls + row.directions,
    spend: 0,
    conversionValue: 0,
    sourcePayload: row as unknown as Record<string, unknown>
  }));
}

export function mapGa4Metrics(identity: BaseIdentity, rows: Ga4MetricRow[]): DailyChannelMetric[] {
  return rows.map((row) => ({
    ...identity,
    date: row.date,
    channel: "ga4",
    impressions: 0,
    clicks: row.sessions,
    calls: 0,
    directions: 0,
    conversions: row.keyEvents,
    spend: 0,
    conversionValue: row.conversionValue,
    sourcePayload: row as unknown as Record<string, unknown>
  }));
}

export function mapGoogleAdsMetrics(identity: BaseIdentity, rows: GoogleAdsMetricRow[]): DailyChannelMetric[] {
  return rows.map((row) => ({
    ...identity,
    date: row.date,
    channel: "google_ads",
    impressions: row.impressions,
    clicks: row.clicks,
    calls: 0,
    directions: 0,
    conversions: row.conversions,
    spend: row.costMicros / 1_000_000,
    conversionValue: row.conversionValue,
    sourcePayload: row as unknown as Record<string, unknown>
  }));
}

export function mapSearchConsoleMetrics(identity: BaseIdentity, rows: SearchConsoleMetricRow[]): DailyChannelMetric[] {
  return rows.map((row) => ({
    ...identity,
    date: row.date,
    channel: "search_console",
    impressions: row.impressions,
    clicks: row.clicks,
    calls: 0,
    directions: 0,
    conversions: 0,
    spend: 0,
    conversionValue: 0,
    sourcePayload: row as unknown as Record<string, unknown>
  }));
}
