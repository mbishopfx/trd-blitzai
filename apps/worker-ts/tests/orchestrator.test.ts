import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { BlitzAutopilotPolicy } from "@trd-aiblitz/domain";
import type { ActionExecutor, ActionPlanner } from "../src/types";
import { LogEventPublisher } from "../src/event-bus";
import { NoopActionExecutor } from "../src/executors/noop";
import { BlitzRunOrchestrator } from "../src/orchestrator";
import { DefaultBlitzPlanner } from "../src/planner";
import { InMemoryBlitzRepository } from "../src/repository/in-memory";

function seedRun() {
  return {
    id: randomUUID(),
    organizationId: "org-1",
    clientId: "client-1",
    status: "created" as const,
    startedAt: null,
    completedAt: null,
    createdBy: "tester",
    createdAt: new Date().toISOString(),
    policySnapshot: {
      revision: 1
    },
    summary: null
  };
}

function seedPolicy(clientId: string, override?: Partial<BlitzAutopilotPolicy>): BlitzAutopilotPolicy {
  return {
    clientId,
    maxDailyActionsPerLocation: 150,
    maxActionsPerPhase: 40,
    minCooldownMinutes: 0,
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
    updatedAt: new Date().toISOString(),
    ...override
  };
}

class PhaseFailExecutor implements ActionExecutor {
  constructor(private readonly failingPhase: string) {}

  async execute(input: { action: { phase: string; actionType: string } }) {
    if (input.action.phase === this.failingPhase) {
      throw new Error(`${this.failingPhase} failure`);
    }

    return {
      output: {
        ok: true,
        actionType: input.action.actionType
      }
    };
  }

  async rollback() {
    return {
      output: {
        ok: true
      }
    };
  }
}

class CriticalFailPlanner implements ActionPlanner {
  async planPhase(input: { phase: string }) {
    if (input.phase === "preflight") {
      return [
        {
          phase: "preflight" as const,
          actionType: "profile_patch" as const,
          riskTier: "low" as const,
          actor: "system" as const,
          payload: { objective: "seed" }
        }
      ];
    }

    if (input.phase === "completeness") {
      return [
        {
          phase: "completeness" as const,
          actionType: "profile_patch" as const,
          riskTier: "critical" as const,
          actor: "system" as const,
          payload: { objective: "critical" }
        }
      ];
    }

    return [];
  }
}

describe("BlitzRunOrchestrator", () => {
  it("completes a run on happy path", async () => {
    const run = seedRun();
    const repository = new InMemoryBlitzRepository({ runs: [run] });

    const orchestrator = new BlitzRunOrchestrator({
      repository,
      planner: new DefaultBlitzPlanner(),
      executor: new NoopActionExecutor(),
      events: new LogEventPublisher(),
      options: {
        defaultThrottleMs: 0
      }
    });

    const result = await orchestrator.executeRun(run.id);
    const actions = await repository.listActions(run.id);

    expect(result.status).toBe("completed");
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.some((action) => action.status === "executed")).toBe(true);
  });

  it("marks run partially completed when a phase action fails", async () => {
    const run = seedRun();
    const repository = new InMemoryBlitzRepository({ runs: [run] });

    const orchestrator = new BlitzRunOrchestrator({
      repository,
      planner: new DefaultBlitzPlanner(),
      executor: new PhaseFailExecutor("media"),
      events: new LogEventPublisher(),
      options: {
        defaultThrottleMs: 0,
        maxActionRetries: 1
      }
    });

    const result = await orchestrator.executeRun(run.id);
    const actions = await repository.listActions(run.id);

    expect(result.status).toBe("partially_completed");
    expect(actions.some((action) => action.phase === "media" && action.status === "failed")).toBe(true);
  });

  it("rolls back when critical failures hit threshold", async () => {
    const run = seedRun();
    const repository = new InMemoryBlitzRepository({
      runs: [run],
      policies: [
        seedPolicy(run.clientId, {
          denyCriticalWithoutEscalation: false
        })
      ]
    });

    const orchestrator = new BlitzRunOrchestrator({
      repository,
      planner: new CriticalFailPlanner(),
      executor: new PhaseFailExecutor("completeness"),
      events: new LogEventPublisher(),
      options: {
        maxCriticalFailuresBeforeRollback: 1,
        maxActionRetries: 1
      }
    });

    const result = await orchestrator.executeRun(run.id);
    const actions = await repository.listActions(run.id);

    expect(result.status).toBe("rolled_back");
    expect(actions.some((action) => action.status === "rolled_back")).toBe(true);
  });
});
