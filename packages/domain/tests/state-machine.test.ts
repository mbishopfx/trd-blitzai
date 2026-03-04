import { describe, expect, it } from "vitest";
import { canTransitionRunStatus, evaluateAutopilotPolicy, transitionRunStatus } from "../src";

describe("run state machine", () => {
  it("allows created -> running -> completed", () => {
    const run = {
      id: "run-1",
      organizationId: "org-1",
      clientId: "client-1",
      status: "created" as const,
      startedAt: null,
      completedAt: null,
      createdBy: "user-1",
      createdAt: new Date().toISOString(),
      policySnapshot: {},
      summary: null
    };

    expect(canTransitionRunStatus("created", "running")).toBe(true);
    const running = transitionRunStatus(run, "running");
    const completed = transitionRunStatus(running, "completed");

    expect(running.startedAt).not.toBeNull();
    expect(completed.completedAt).not.toBeNull();
  });

  it("rejects invalid transitions", () => {
    expect(canTransitionRunStatus("created", "completed")).toBe(false);
  });
});

describe("autopilot policy", () => {
  it("returns escalation decision for critical actions", () => {
    const policy = {
      clientId: "client-1",
      maxDailyActionsPerLocation: 100,
      maxActionsPerPhase: 20,
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

    const result = evaluateAutopilotPolicy(policy, {
      actionType: "profile_patch",
      riskTier: "critical",
      usage: {
        actionsExecutedToday: 0,
        actionsInPhase: 0
      }
    });

    expect(result.decision).toBe("allow_with_escalation");
    expect(result.allowed).toBe(false);
  });
});
