import type {
  BlitzActionType,
  BlitzAutopilotPolicy,
  PolicyEvaluationResult,
  PolicyUsageCounters,
  RiskTier
} from "./types";

export interface EvaluatePolicyInput {
  actionType: BlitzActionType;
  riskTier: RiskTier;
  usage: PolicyUsageCounters;
  isReviewActionForAllRatings?: boolean;
}

export function evaluateAutopilotPolicy(
  policy: BlitzAutopilotPolicy,
  input: EvaluatePolicyInput
): PolicyEvaluationResult {
  if (!policy.enabledActionTypes.includes(input.actionType)) {
    return {
      decision: "deny",
      allowed: false,
      requiresEscalation: false,
      reason: `action type ${input.actionType} disabled in policy`
    };
  }

  if (input.actionType === "review_reply" && input.isReviewActionForAllRatings && !policy.reviewReplyAllRatingsEnabled) {
    return {
      decision: "deny",
      allowed: false,
      requiresEscalation: false,
      reason: "review replies for all ratings disabled"
    };
  }

  if (input.riskTier === "critical" && policy.denyCriticalWithoutEscalation) {
    return {
      decision: "allow_with_escalation",
      allowed: false,
      requiresEscalation: true,
      reason: "critical risk requires operator escalation"
    };
  }

  if (input.usage.actionsInPhase >= policy.maxActionsPerPhase) {
    return {
      decision: "allow_with_limit",
      allowed: false,
      requiresEscalation: false,
      reason: "phase action limit reached",
      throttleMs: policy.minCooldownMinutes * 60_000
    };
  }

  if (input.usage.actionsExecutedToday >= policy.maxDailyActionsPerLocation) {
    return {
      decision: "allow_with_limit",
      allowed: false,
      requiresEscalation: false,
      reason: "daily action cap reached",
      throttleMs: policy.minCooldownMinutes * 60_000
    };
  }

  if (input.riskTier === "high") {
    return {
      decision: "allow_with_limit",
      allowed: true,
      requiresEscalation: false,
      reason: "high risk allowed with throttle",
      throttleMs: Math.max(250, policy.minCooldownMinutes * 1_000)
    };
  }

  return {
    decision: "allow",
    allowed: true,
    requiresEscalation: false,
    reason: "policy checks passed"
  };
}
