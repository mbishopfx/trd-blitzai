import { describe, expect, it } from "vitest";
import { mapGoogleAdsMetrics, normalizeDailyMetrics } from "../src";

describe("attribution normalization", () => {
  it("aggregates multiple channels by date", () => {
    const blended = normalizeDailyMetrics([
      {
        organizationId: "org-1",
        clientId: "client-1",
        locationId: "loc-1",
        date: "2026-03-01",
        channel: "gbp",
        impressions: 10,
        clicks: 3,
        calls: 1,
        directions: 2,
        conversions: 3,
        spend: 0,
        conversionValue: 0,
        sourcePayload: {}
      },
      {
        organizationId: "org-1",
        clientId: "client-1",
        locationId: "loc-1",
        date: "2026-03-01",
        channel: "google_ads",
        impressions: 20,
        clicks: 4,
        calls: 0,
        directions: 0,
        conversions: 2,
        spend: 25,
        conversionValue: 100,
        sourcePayload: {}
      }
    ]);

    expect(blended).toHaveLength(1);
    expect(blended[0].impressions).toBe(30);
    expect(blended[0].conversions).toBe(5);
    expect(blended[0].channels).toContain("gbp");
    expect(blended[0].channels).toContain("google_ads");
  });

  it("maps google ads metrics using spend micros", () => {
    const rows = mapGoogleAdsMetrics(
      {
        organizationId: "org-1",
        clientId: "client-1",
        locationId: "loc-1"
      },
      [
        {
          date: "2026-03-02",
          impressions: 100,
          clicks: 20,
          conversions: 5,
          costMicros: 1_250_000,
          conversionValue: 250
        }
      ]
    );

    expect(rows[0].spend).toBe(1.25);
    expect(rows[0].channel).toBe("google_ads");
  });
});
