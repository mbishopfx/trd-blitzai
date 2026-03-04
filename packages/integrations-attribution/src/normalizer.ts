import type { BlendedDailyMetric, DailyChannelMetric } from "./contracts";

export function normalizeDailyMetrics(records: DailyChannelMetric[]): BlendedDailyMetric[] {
  const map = new Map<string, BlendedDailyMetric>();

  for (const record of records) {
    const key = [record.organizationId, record.clientId, record.locationId ?? "none", record.date].join(":");
    const existing = map.get(key);

    if (!existing) {
      map.set(key, {
        organizationId: record.organizationId,
        clientId: record.clientId,
        locationId: record.locationId,
        date: record.date,
        impressions: record.impressions,
        clicks: record.clicks,
        calls: record.calls,
        directions: record.directions,
        conversions: record.conversions,
        spend: record.spend,
        conversionValue: record.conversionValue,
        channels: [record.channel]
      });
      continue;
    }

    existing.impressions += record.impressions;
    existing.clicks += record.clicks;
    existing.calls += record.calls;
    existing.directions += record.directions;
    existing.conversions += record.conversions;
    existing.spend += record.spend;
    existing.conversionValue += record.conversionValue;
    if (!existing.channels.includes(record.channel)) {
      existing.channels.push(record.channel);
    }
  }

  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}
