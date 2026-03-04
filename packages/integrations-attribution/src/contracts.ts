export type AttributionChannel = "gbp" | "ga4" | "google_ads";

export interface DailyChannelMetric {
  organizationId: string;
  clientId: string;
  locationId: string | null;
  date: string;
  channel: AttributionChannel;
  impressions: number;
  clicks: number;
  calls: number;
  directions: number;
  conversions: number;
  spend: number;
  conversionValue: number;
  sourcePayload: Record<string, unknown>;
}

export interface BlendedDailyMetric {
  organizationId: string;
  clientId: string;
  locationId: string | null;
  date: string;
  impressions: number;
  clicks: number;
  calls: number;
  directions: number;
  conversions: number;
  spend: number;
  conversionValue: number;
  channels: AttributionChannel[];
}

export interface BlitzImpactSummary {
  organizationId: string;
  clientId: string;
  locationId: string | null;
  window: "7d" | "30d" | "90d";
  baselineConversions: number;
  currentConversions: number;
  baselineSpend: number;
  currentSpend: number;
  blendedCostPerResult: number;
  directionalLiftPct: number;
}

export interface GbpNativeMetricRow {
  date: string;
  impressions: number;
  viewsOnMaps: number;
  websiteClicks: number;
  calls: number;
  directions: number;
}

export interface Ga4MetricRow {
  date: string;
  sessions: number;
  keyEvents: number;
  conversionValue: number;
}

export interface GoogleAdsMetricRow {
  date: string;
  impressions: number;
  clicks: number;
  conversions: number;
  costMicros: number;
  conversionValue: number;
}
