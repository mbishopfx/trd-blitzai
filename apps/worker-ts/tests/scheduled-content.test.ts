import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { BlitzRun } from "@trd-aiblitz/domain";
import type { ActionExecutor } from "../src/types";
import { InMemoryBlitzRepository } from "../src/repository/in-memory";
import { dispatchDueContentArtifactsOnce } from "../src/scheduled-content";

function seedRun(): BlitzRun {
  return {
    id: randomUUID(),
    organizationId: "org-1",
    clientId: "client-1",
    status: "created",
    startedAt: null,
    completedAt: null,
    createdBy: "tester",
    createdAt: new Date().toISOString(),
    policySnapshot: {},
    summary: null
  };
}

class SuccessExecutor implements ActionExecutor {
  async execute() {
    return {
      output: {
        ok: true
      }
    };
  }
}

class FailExecutor implements ActionExecutor {
  async execute(): Promise<never> {
    throw new Error("publish failed");
  }
}

describe("dispatchDueContentArtifactsOnce", () => {
  it("publishes due scheduled artifacts and marks them published", async () => {
    const run = seedRun();
    const repository = new InMemoryBlitzRepository({ runs: [run] });

    await repository.createContentArtifact({
      organizationId: run.organizationId,
      clientId: run.clientId,
      phase: "content",
      channel: "gbp",
      title: "Scheduled artifact",
      body: "Scheduled body",
      status: "scheduled",
      scheduledFor: new Date(Date.now() - 60_000).toISOString(),
      metadata: {
        dispatchActionType: "post_publish",
        actionPayload: {
          objective: "manual_post_tool_publish",
          landingUrl: "https://example.com/post"
        }
      }
    });

    const summary = await dispatchDueContentArtifactsOnce({
      repository,
      executor: new SuccessExecutor(),
      batchSize: 5,
      workerId: "test-worker",
      source: "test-dispatcher"
    });

    expect(summary.attemptedCount).toBe(1);
    expect(summary.publishedCount).toBe(1);
    expect(summary.failedCount).toBe(0);
    expect(summary.publishedArtifactIds).toHaveLength(1);

    const dueArtifacts = await repository.listDueContentArtifacts(5);
    expect(dueArtifacts).toHaveLength(0);

    const storedArtifacts = (repository as unknown as { state: { contentArtifacts: Array<{ id: string; status: string; publishedAt: string | null }> } }).state.contentArtifacts;
    expect(storedArtifacts[0]?.status).toBe("published");
    expect(storedArtifacts[0]?.publishedAt).not.toBeNull();
  });

  it("reschedules failed artifacts and records the failure", async () => {
    const run = seedRun();
    const repository = new InMemoryBlitzRepository({ runs: [run] });

    await repository.createContentArtifact({
      organizationId: run.organizationId,
      clientId: run.clientId,
      phase: "content",
      channel: "gbp",
      title: "Scheduled artifact",
      body: "Scheduled body",
      status: "scheduled",
      scheduledFor: new Date(Date.now() - 60_000).toISOString(),
      metadata: {
        dispatchActionType: "post_publish",
        actionPayload: {
          objective: "manual_post_tool_publish",
          landingUrl: "https://example.com/post"
        }
      }
    });

    const summary = await dispatchDueContentArtifactsOnce({
      repository,
      executor: new FailExecutor(),
      batchSize: 5,
      workerId: "test-worker",
      source: "test-dispatcher"
    });

    expect(summary.attemptedCount).toBe(1);
    expect(summary.publishedCount).toBe(0);
    expect(summary.failedCount).toBe(1);
    expect(summary.failedArtifacts[0]?.error).toBe("publish failed");

    const storedArtifacts = (repository as unknown as { state: { contentArtifacts: Array<{ status: string; scheduledFor: string | null; metadata: Record<string, unknown> }> } }).state.contentArtifacts;
    expect(storedArtifacts[0]?.status).toBe("scheduled");
    expect(storedArtifacts[0]?.scheduledFor).not.toBeNull();
    expect(storedArtifacts[0]?.metadata.lastDispatchError).toBe("publish failed");
  });
});
