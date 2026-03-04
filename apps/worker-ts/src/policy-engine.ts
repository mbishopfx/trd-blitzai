import { evaluateAutopilotPolicy } from "@trd-aiblitz/domain";
import type { BlitzAutopilotPolicy, PolicyEvaluationResult } from "@trd-aiblitz/domain";
import type { PlannedAction } from "./types";

export interface PolicyEvaluationInput {
  policy: BlitzAutopilotPolicy;
  action: PlannedAction;
  actionsExecutedToday: number;
  actionsExecutedInPhase: number;
}

export function evaluateActionPolicyGate(input: PolicyEvaluationInput): PolicyEvaluationResult {
  return evaluateAutopilotPolicy(input.policy, {
    actionType: input.action.actionType,
    riskTier: input.action.riskTier,
    usage: {
      actionsExecutedToday: input.actionsExecutedToday,
      actionsInPhase: input.actionsExecutedInPhase
    },
    isReviewActionForAllRatings: input.action.isReviewActionForAllRatings
  });
}
