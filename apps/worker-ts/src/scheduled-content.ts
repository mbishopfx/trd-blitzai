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

function resolveDispatchActionType(value: unknown): BlitzAction["actionType"] {
  if (typeof value !== "string") {
    return "post_publish";
  }
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "profile_patch" ||
    normalized === "media_upload" ||
    normalized === "post_publish" ||
    normalized === "review_reply" ||
    normalized === "hours_update" ||
    normalized === "attribute_update"
  ) {
    return normalized;
  }
  return "post_publish";
}

function resolveRiskTier(value: unknown): BlitzAction["riskTier"] {
  if (typeof value !== "string") {
    return "medium";
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "low" || normalized === "medium" || normalized === "high" || normalized === "critical") {
    return normalized;
  }
  return "medium";
}

export interface ScheduledContentDispatcher {
  close(): Promise<void>;
}

export interface ScheduledDispatchSummary {
  attemptedCount: number;
  publishedCount: number;
  failedCount: number;
  skippedCount: number;
  publishedArtifactIds: string[];
  failedArtifacts: Array<{ artifactId: string; error: string; terminal: boolean }>;
  skippedArtifacts: Array<{ artifactId: string; reason: string }>;
}

export async function dispatchDueContentArtifactsOnce(input: {
  repository: BlitzRunRepository;
  executor: ActionExecutor;
  batchSize?: number;
  workerId?: string;
  source?: string;
}): Promise<ScheduledDispatchSummary> {
  if (!input.repository.listDueContentArtifacts || !input.repository.updateContentArtifact) {
    logger.warn("repository does not support scheduled content dispatch");
    return {
      attemptedCount: 0,
      publishedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      publishedArtifactIds: [],
      failedArtifacts: [],
      skippedArtifacts: []
    };
  }

  const batchSize = Math.max(1, input.batchSize ?? 10);
  const workerId = input.workerId ?? randomUUID();
  const source = input.source ?? "scheduled-content-dispatcher";
  const summary: ScheduledDispatchSummary = {
    attemptedCount: 0,
    publishedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    publishedArtifactIds: [],
    failedArtifacts: [],
    skippedArtifacts: []
  };

  const dueArtifacts = await input.repository.listDueContentArtifacts(batchSize);
  for (const artifact of dueArtifacts) {
    summary.attemptedCount += 1;

    const attempts = Number(asRecord(artifact.metadata).dispatchAttempts ?? 0);
    const claimedMetadata = {
      ...artifact.metadata,
      dispatchAttempts: attempts + 1,
      dispatchClaimedAt: nowIso(),
      dispatchWorkerId: workerId
    };
    await input.repository.updateContentArtifact(artifact.id, {
      metadata: claimedMetadata,
      scheduledFor: minutesFromNow(10)
    });

    const artifactMetadata = asRecord(artifact.metadata);
    if (artifact.channel === "gbp_qna_seed" && typeof artifactMetadata.dispatchActionType !== "string") {
      const reason = "Q&A seed artifacts require manual workflow and cannot be auto-dispatched.";
      await input.repository.updateContentArtifact(artifact.id, {
        status: "failed",
        metadata: {
          ...claimedMetadata,
          lastDispatchError: reason
        }
      });
      summary.skippedCount += 1;
      summary.skippedArtifacts.push({
        artifactId: artifact.id,
        reason
      });
      continue;
    }

    const run: BlitzRun = {
      id: randomUUID(),
      organizationId: artifact.organizationId,
      clientId: artifact.clientId,
      status: "running",
      startedAt: nowIso(),
      completedAt: null,
      createdBy: source,
      createdAt: nowIso(),
      policySnapshot: {
        source,
        artifactId: artifact.id,
        syntheticRun: true
      },
      summary: null
    };

    const dispatchActionType = resolveDispatchActionType(artifactMetadata.dispatchActionType);
    const dispatchPayload = asRecord(artifactMetadata.actionPayload);
    const actionPayload =
      dispatchActionType === "post_publish" && Object.keys(dispatchPayload).length === 0
        ? {
            objective: "publish_scheduled_artifact",
            artifact
          }
        : Object.keys(dispatchPayload).length
          ? dispatchPayload
          : {
              objective: `scheduled_${dispatchActionType}`,
              artifactId: artifact.id
            };
    const dispatchRiskTier = resolveRiskTier(artifactMetadata.dispatchRiskTier);

    const action: BlitzAction = {
      id: randomUUID(),
      runId: run.id,
      organizationId: artifact.organizationId,
      clientId: artifact.clientId,
      phase: artifact.phase,
      actionType: dispatchActionType,
      riskTier: dispatchRiskTier,
      policyDecision: "allow",
      status: "pending",
      actor: "system",
      idempotencyKey: `scheduled-content:${artifact.id}:${dispatchActionType}`,
      payload: actionPayload,
      policySnapshot: {
        source,
        dispatchActionType,
        dispatchRiskTier
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
      await input.repository.updateContentArtifact(artifact.id, {
        status: "published",
        publishedAt: nowIso(),
        metadata: {
          ...claimedMetadata,
          dispatchResult: result.output
        }
      });
      summary.publishedCount += 1;
      summary.publishedArtifactIds.push(artifact.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const nextAttemptCount = attempts + 1;
      const terminal = nextAttemptCount >= 3;
      await input.repository.updateContentArtifact(artifact.id, {
        status: terminal ? "failed" : "scheduled",
        scheduledFor: terminal ? artifact.scheduledFor ?? null : minutesFromNow(30),
        metadata: {
          ...claimedMetadata,
          lastDispatchError: message,
          lastDispatchErrorAt: nowIso()
        }
      });
      logger.error({ artifactId: artifact.id, error: message }, "scheduled content dispatch failed");
      summary.failedCount += 1;
      summary.failedArtifacts.push({
        artifactId: artifact.id,
        error: message,
        terminal
      });
    }
  }

  return summary;
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
      await dispatchDueContentArtifactsOnce({
        repository: input.repository,
        executor: input.executor,
        batchSize,
        workerId,
        source: "scheduled-content-dispatcher"
      });
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
