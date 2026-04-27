import type { GbpReview } from "./types";

function ratingToNumber(starRating: string | undefined): number {
  if (!starRating) {
    return 0;
  }

  const map: Record<string, number> = {
    ONE: 1,
    TWO: 2,
    THREE: 3,
    FOUR: 4,
    FIVE: 5
  };

  const normalized = starRating.toUpperCase();
  if (map[normalized]) {
    return map[normalized];
  }

  const parsed = Number.parseInt(starRating, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function trimComment(comment: string | undefined): string {
  if (!comment) {
    return "";
  }
  const normalized = comment.replace(/\s+/g, " ").trim();
  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}

export function hasReviewComment(comment: string | undefined): boolean {
  return trimComment(comment).length > 0;
}

export function generateReviewReply(input: {
  review: GbpReview;
  businessName: string;
  brandVoice?: string;
}): string {
  const rating = ratingToNumber(input.review.starRating);
  const comment = trimComment(input.review.comment);

  if (rating >= 4) {
    if (comment) {
      return `Thanks for the review. We're glad you had a good experience with ${input.businessName}, and we appreciate you taking the time to share your feedback.`;
    }

    return `Thanks for the 5-star review. We appreciate your support and are glad we could help.`;
  }

  if (rating === 3) {
    if (comment) {
      return `Thanks for the feedback. We appreciate you letting us know about your experience and will use it to keep improving.`;
    }

    return `Thanks for the feedback. We appreciate the review and will keep working to improve the experience we provide.`;
  }

  if (comment) {
    return `Thanks for the feedback. We're sorry your experience did not meet expectations. Please contact us directly so we can learn more and work to make this right.`;
  }

  return `Thanks for the feedback. We're sorry your experience did not meet expectations. Please contact us directly so we can help.`;
}
