import { describe, expect, it } from "vitest";
import type { BlitzAutopilotPolicy } from "@trd-aiblitz/domain";
import { evaluateActionPolicyGate } from "../src/policy-engine";

function basePolicy(): BlitzAutopilotPolicy {
  return {
    clientId: "client-1",
    maxDailyActionsPerLocation: 5,
    maxActionsPerPhase: 2,
    minCooldownMinutes: 10,
    denyCriticalWithoutEscalation: true,
    enabledActionTypes: [
      "profile_patch",
      "media_upload",
      "post_publish",
      "review_reply",
      "hours_update",
      "attribute_update"
    ],
    reviewReplyAllRatingsEnabled: true,
    updatedAt: new Date().toISOString()
  };
}

describe("policy gate", () => {
  it("denies disabled action types", () => {
    const policy = basePolicy();
    policy.enabledActionTypes = ["profile_patch"];

    const result = evaluateActionPolicyGate({
      policy,
      action: {
        phase: "reviews",
        actionType: "review_reply",
        riskTier: "high",
        actor: "system",
        payload: {}
      },
      actionsExecutedToday: 0,
      actionsExecutedInPhase: 0
    });

    expect(result.allowed).toBe(false);
    expect(result.decision).toBe("deny");
  });

  it("requires escalation for critical actions when policy mandates it", () => {
    const result = evaluateActionPolicyGate({
      policy: basePolicy(),
      action: {
        phase: "preflight",
        actionType: "profile_patch",
        riskTier: "critical",
        actor: "system",
        payload: {}
      },
      actionsExecutedToday: 0,
      actionsExecutedInPhase: 0
    });

    expect(result.allowed).toBe(false);
    expect(result.requiresEscalation).toBe(true);
    expect(result.decision).toBe("allow_with_escalation");
  });

  it("throttles high-risk actions but still allows them", () => {
    const result = evaluateActionPolicyGate({
      policy: basePolicy(),
      action: {
        phase: "reviews",
        actionType: "review_reply",
        riskTier: "high",
        actor: "system",
        payload: {}
      },
      actionsExecutedToday: 1,
      actionsExecutedInPhase: 1
    });

    expect(result.allowed).toBe(true);
    expect(result.decision).toBe("allow_with_limit");
    expect(result.throttleMs).toBeGreaterThan(0);
  });

  it("blocks actions when phase cap is exceeded", () => {
    const result = evaluateActionPolicyGate({
      policy: basePolicy(),
      action: {
        phase: "media",
        actionType: "media_upload",
        riskTier: "low",
        actor: "system",
        payload: {}
      },
      actionsExecutedToday: 1,
      actionsExecutedInPhase: 2
    });

    expect(result.allowed).toBe(false);
    expect(result.decision).toBe("allow_with_limit");
  });
});
