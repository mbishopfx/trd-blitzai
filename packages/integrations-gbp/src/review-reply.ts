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
  const signature = input.brandVoice?.trim() || input.businessName;

  if (rating >= 4) {
    return [
      `Thanks for sharing this feedback about ${input.businessName}.`,
      comment ? `We appreciate the details: "${comment}".` : "Thank you for the positive rating, we appreciate you taking the time to support us!",
      `- ${signature}`
    ].join(" ");
  }

  if (rating === 3) {
    return [
      `Thank you for the honest feedback about ${input.businessName}.`,
      comment ? `We are reviewing your comments: "${comment}" internally.` : "We appreciate the rating and would value a chance to improve your next visit.",
      `- ${signature}`
    ].join(" ");
  }

  return [
    `Thank you for flagging this. We are sorry your experience with ${input.businessName} missed expectations.`,
    comment ? `We are investigating your feedback: "${comment}" quickly.` : "Please contact us directly so we can learn more about your experience and make this right.",
    `- ${signature}`
  ].join(" ");
}
