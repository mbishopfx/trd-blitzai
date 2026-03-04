import { GbpApiClient } from "./client";
import type { GbpSnapshot } from "./types";

function normalizeLocationName(locationId: string): string {
  return locationId.startsWith("locations/") ? locationId : `locations/${locationId}`;
}

function bareLocationId(locationId: string): string {
  return locationId.replace(/^locations\//, "");
}

function bareAccountId(accountId: string): string {
  return accountId.replace(/^accounts\//, "");
}

export async function fetchFullSnapshot(
  client: GbpApiClient,
  input: { accountId: string; locationId: string }
): Promise<GbpSnapshot> {
  const accountId = bareAccountId(input.accountId);
  const locationId = bareLocationId(input.locationId);
  const locationName = normalizeLocationName(locationId);

  const [businessInfo, reviews, posts] = await Promise.all([
    client.fetchLocation(locationName),
    client.fetchReviews(accountId, locationId),
    client.listPosts(accountId, locationId)
  ]);

  return {
    locationName,
    businessInfo,
    reviews,
    posts,
    fetchedAt: new Date().toISOString()
  };
}
