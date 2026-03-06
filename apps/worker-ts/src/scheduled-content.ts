import { randomUUID } from "node:crypto";
import pino from "pino";
import type { BlitzAction, BlitzRun } from "@trd-aiblitz/domain";
import type { ActionExecutor, BlitzRunRepository, ContentArtifactRecord } from "./types";

const logger = pino({ name: "aiblitz-scheduled-content" });

function nowIso(): string {
  return new Date().toISOString();
}

function minutesFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export interface ScheduledContentDispatcher {
  close(): Promise<void>;
}

export function startScheduledContentDispatcher(input: {
  repository: BlitzRunRepository;
  executor: ActionExecutor;
  intervalMs?: number;
  batchSize?: number;
}): ScheduledContentDispatcher {
  if (!input.repository.listDueContentArtifacts || !input.repository.updateContentArtifact) {
    logger.warn("repository does not support scheduled content dispatch");
    return {
      async close() {}
    };
  }

  const intervalMs = Math.max(15_000, input.intervalMs ?? 60_000);
  const batchSize = Math.max(1, input.batchSize ?? 10);
  const workerId = randomUUID();
  let timer: NodeJS.Timeout | null = null;
  let running = false;

  const tick = async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      const dueArtifacts = await input.repository.listDueContentArtifacts!(batchSize);
      for (const artifact of dueArtifacts) {
        const attempts = Number(asRecord(artifact.metadata).dispatchAttempts ?? 0);
        const claimedMetadata = {
          ...artifact.metadata,
          dispatchAttempts: attempts + 1,
          dispatchClaimedAt: nowIso(),
          dispatchWorkerId: workerId
        };
        await input.repository.updateContentArtifact!(artifact.id, {
          metadata: claimedMetadata,
          scheduledFor: minutesFromNow(10)
        });

        const run: BlitzRun = {
          id: `scheduled-artifact-${artifact.id}`,
          organizationId: artifact.organizationId,
          clientId: artifact.clientId,
          status: "running",
          startedAt: nowIso(),
          completedAt: null,
          createdBy: "scheduled-content-dispatcher",
          createdAt: nowIso(),
          policySnapshot: {
            source: "scheduled-content-dispatcher",
            artifactId: artifact.id
          },
          summary: null
        };

        const action: BlitzAction = {
          id: randomUUID(),
          runId: run.id,
          organizationId: artifact.organizationId,
          clientId: artifact.clientId,
          phase: artifact.phase,
          actionType: "post_publish",
          riskTier: "medium",
          policyDecision: "allow",
          status: "pending",
          actor: "system",
          idempotencyKey: `scheduled-content:${artifact.id}`,
          payload: {
            objective: "publish_scheduled_artifact",
            artifact
          },
          policySnapshot: {
            source: "scheduled-content-dispatcher"
          },
          result: null,
          error: null,
          createdAt: nowIso(),
          executedAt: null,
          rolledBackAt: null
        };

        try {
          const result = await input.executor.execute({
            run,
            action
          });
          await input.repository.updateContentArtifact!(artifact.id, {
            status: "published",
            publishedAt: nowIso(),
            metadata: {
              ...claimedMetadata,
              dispatchResult: result.output
            }
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const nextAttemptCount = attempts + 1;
          const terminal = nextAttemptCount >= 3;
          await input.repository.updateContentArtifact!(artifact.id, {
            status: terminal ? "failed" : "scheduled",
            scheduledFor: terminal ? artifact.scheduledFor ?? null : minutesFromNow(30),
            metadata: {
              ...claimedMetadata,
              lastDispatchError: message,
              lastDispatchErrorAt: nowIso()
            }
          });
          logger.error({ artifactId: artifact.id, error: message }, "scheduled content dispatch failed");
        }
      }
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, "scheduled content tick failed");
    } finally {
      running = false;
    }
  };

  void tick();
  timer = setInterval(() => {
    void tick();
  }, intervalMs);

  return {
    async close() {
      if (timer) {
        clearInterval(timer);
      }
    }
  };
}
