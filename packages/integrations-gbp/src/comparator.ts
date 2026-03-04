import type { GbpReview, GbpSnapshot, SnapshotChange } from "./types";

function parseStarRating(value: string | number | undefined): number {
  if (typeof value === "number") {
    return value;
  }
  if (!value) {
    return 0;
  }

  const normalized = String(value).toUpperCase();
  const map: Record<string, number> = {
    ONE: 1,
    TWO: 2,
    THREE: 3,
    FOUR: 4,
    FIVE: 5
  };

  if (map[normalized]) {
    return map[normalized];
  }

  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function averageRating(reviews: GbpReview[]): number {
  if (!reviews.length) {
    return 0;
  }
  const total = reviews.reduce((acc, review) => acc + parseStarRating(review.starRating), 0);
  return Math.round((total / reviews.length) * 100) / 100;
}

export function compareSnapshots(oldSnapshot: GbpSnapshot, newSnapshot: GbpSnapshot): SnapshotChange[] {
  const changes: SnapshotChange[] = [];

  const oldInfo = oldSnapshot.businessInfo;
  const newInfo = newSnapshot.businessInfo;

  if (oldInfo?.title !== newInfo?.title) {
    changes.push({
      changeType: "business_info",
      fieldName: "title",
      oldValue: oldInfo?.title,
      newValue: newInfo?.title,
      severity: "critical"
    });
  }

  const oldPhone = oldInfo?.phoneNumbers?.primaryPhone ?? oldInfo?.primaryPhone;
  const newPhone = newInfo?.phoneNumbers?.primaryPhone ?? newInfo?.primaryPhone;
  if (oldPhone !== newPhone) {
    changes.push({
      changeType: "business_info",
      fieldName: "primaryPhone",
      oldValue: oldPhone,
      newValue: newPhone,
      severity: "high"
    });
  }

  const oldAddress = JSON.stringify(oldInfo?.storefrontAddress ?? null);
  const newAddress = JSON.stringify(newInfo?.storefrontAddress ?? null);
  if (oldAddress !== newAddress) {
    changes.push({
      changeType: "business_info",
      fieldName: "storefrontAddress",
      oldValue: oldInfo?.storefrontAddress,
      newValue: newInfo?.storefrontAddress,
      severity: "critical"
    });
  }

  if (oldInfo?.websiteUri !== newInfo?.websiteUri) {
    changes.push({
      changeType: "business_info",
      fieldName: "websiteUri",
      oldValue: oldInfo?.websiteUri,
      newValue: newInfo?.websiteUri,
      severity: "high"
    });
  }

  const oldHours = JSON.stringify(oldInfo?.regularHours ?? null);
  const newHours = JSON.stringify(newInfo?.regularHours ?? null);
  if (oldHours !== newHours) {
    changes.push({
      changeType: "business_info",
      fieldName: "regularHours",
      oldValue: oldInfo?.regularHours,
      newValue: newInfo?.regularHours,
      severity: "medium"
    });
  }

  const oldCategories = JSON.stringify(oldInfo?.categories ?? []);
  const newCategories = JSON.stringify(newInfo?.categories ?? []);
  if (oldCategories !== newCategories) {
    changes.push({
      changeType: "business_info",
      fieldName: "categories",
      oldValue: oldInfo?.categories,
      newValue: newInfo?.categories,
      severity: "high"
    });
  }

  const oldReviewMap = new Map(oldSnapshot.reviews.map((review) => [review.name, review]));
  const newReviewMap = new Map(newSnapshot.reviews.map((review) => [review.name, review]));

  for (const [key, review] of newReviewMap.entries()) {
    if (!oldReviewMap.has(key)) {
      changes.push({
        changeType: "review",
        fieldName: "new_review",
        oldValue: null,
        newValue: {
          reviewId: key,
          rating: parseStarRating(review.starRating),
          comment: review.comment
        },
        severity: "high"
      });
    }
  }

  const oldAvg = averageRating(oldSnapshot.reviews);
  const newAvg = averageRating(newSnapshot.reviews);
  if (oldAvg !== newAvg) {
    changes.push({
      changeType: "rating",
      fieldName: "average_rating",
      oldValue: oldAvg,
      newValue: newAvg,
      severity: Math.abs(newAvg - oldAvg) >= 0.5 ? "high" : "medium"
    });
  }

  const oldPosts = new Set(oldSnapshot.posts.map((post) => post.name));
  const newPosts = new Set(newSnapshot.posts.map((post) => post.name));

  for (const postName of newPosts) {
    if (!oldPosts.has(postName)) {
      changes.push({
        changeType: "post",
        fieldName: "new_post",
        oldValue: null,
        newValue: { postName },
        severity: "medium"
      });
    }
  }

  for (const postName of oldPosts) {
    if (!newPosts.has(postName)) {
      changes.push({
        changeType: "post",
        fieldName: "deleted_post",
        oldValue: { postName },
        newValue: null,
        severity: "low"
      });
    }
  }

  return changes;
}
