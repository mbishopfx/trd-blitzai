import type { GbpHealthScore, GbpSnapshot } from "./types";

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).length > 0;
  }
  return true;
}

function daysSince(timestamp: string | null | undefined): number {
  if (!timestamp) {
    return Number.POSITIVE_INFINITY;
  }
  const value = new Date(timestamp).getTime();
  if (Number.isNaN(value)) {
    return Number.POSITIVE_INFINITY;
  }
  return (Date.now() - value) / (24 * 60 * 60 * 1000);
}

export function scoreSnapshotHealth(snapshot: GbpSnapshot): GbpHealthScore {
  const info = snapshot.businessInfo;

  const criticalChecks: Array<[string, boolean]> = [
    ["title", hasValue(info?.title)],
    ["storefrontAddress", hasValue(info?.storefrontAddress)],
    ["primaryPhone", hasValue(info?.phoneNumbers?.primaryPhone ?? info?.primaryPhone)],
    ["categories", hasValue(info?.categories)],
    ["regularHours", hasValue(info?.regularHours)]
  ];

  const recommendedChecks: Array<[string, boolean]> = [
    ["websiteUri", hasValue(info?.websiteUri)],
    ["profileDescription", hasValue(info?.profile)],
    ["attributes", hasValue(info?.attributes)],
    ["recentPosts", snapshot.posts.length > 0],
    ["recentReviews", snapshot.reviews.length > 0]
  ];

  const missingCritical = criticalChecks.filter(([, present]) => !present).map(([name]) => name);
  const missingRecommended = recommendedChecks.filter(([, present]) => !present).map(([name]) => name);

  const newestPost = snapshot.posts
    .map((post) => post.updateTime ?? post.createTime ?? null)
    .sort((a, b) => (a ?? "").localeCompare(b ?? ""))
    .at(-1);

  const newestReview = snapshot.reviews
    .map((review) => review.updateTime ?? review.createTime)
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .sort((a, b) => a.localeCompare(b))
    .at(-1);

  const staleSignals: string[] = [];
  if (daysSince(newestPost) > 30) {
    staleSignals.push("posts_stale_over_30_days");
  }
  if (daysSince(newestReview) > 30) {
    staleSignals.push("reviews_stale_over_30_days");
  }

  const criticalScore = (criticalChecks.filter(([, present]) => present).length / criticalChecks.length) * 70;
  const recommendedScore =
    (recommendedChecks.filter(([, present]) => present).length / recommendedChecks.length) * 30;
  const stalenessPenalty = staleSignals.length * 5;

  return {
    completenessScore: Math.max(0, Math.round(criticalScore + recommendedScore - stalenessPenalty)),
    missingCritical,
    missingRecommended,
    staleSignals
  };
}
