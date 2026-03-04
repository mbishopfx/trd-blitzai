import type { BlitzActionType, BlitzPhase, RiskTier } from "@trd-aiblitz/domain";

export const BLITZ_PHASE_ORDER: BlitzPhase[] = [
  "preflight",
  "completeness",
  "media",
  "content",
  "reviews",
  "interaction",
  "postcheck"
];

export const ACTION_TYPE_BY_PHASE: Record<BlitzPhase, BlitzActionType> = {
  preflight: "profile_patch",
  completeness: "attribute_update",
  media: "media_upload",
  content: "post_publish",
  reviews: "review_reply",
  interaction: "hours_update",
  postcheck: "profile_patch"
};

export const RISK_TIER_BY_PHASE: Record<BlitzPhase, RiskTier> = {
  preflight: "low",
  completeness: "medium",
  media: "low",
  content: "medium",
  reviews: "high",
  interaction: "medium",
  postcheck: "low"
};

export const ROLLBACK_ELIGIBLE_ACTIONS = new Set<BlitzActionType>([
  "profile_patch",
  "hours_update",
  "attribute_update",
  "post_publish"
]);
