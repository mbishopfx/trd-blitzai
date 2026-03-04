import { randomUUID } from "node:crypto";
import {
  type BlitzPhase,
  type BlitzPhaseSummary,
  type BlitzRun,
  type BlitzRunSummary
} from "@trd-aiblitz/domain";
import { BLITZ_PHASE_ORDER, ROLLBACK_ELIGIBLE_ACTIONS } from "./constants";
import { buildActionIdempotencyKey } from "./idempotency";
import { evaluateActionPolicyGate } from "./policy-engine";
import { retryWithBackoff } from "./retry";
import type {
  ActionExecutor,
  ActionPlanner,
  BlitzRunRepository,
  EventPublisher,
  OrchestratorOptions,
  PlannedAction
} from "./types";

const DEFAULT_OPTIONS: OrchestratorOptions = {
  maxActionRetries: 3,
  maxCriticalFailuresBeforeRollback: 2,
  defaultThrottleMs: 0
};

function nowIso(): string {
  return new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function emptyPhaseSummary(phase: BlitzPhase): BlitzPhaseSummary {
  return {
    phase,
    attempted: 0,
    executed: 0,
    failed: 0,
    skipped: 0
  };
}

function toSummary(input: {
  phaseSummaries: Map<BlitzPhase, BlitzPhaseSummary>;
  attemptedActions: number;
  executedActions: number;
  failedActions: number;
  skippedActions: number;
  rollbackCount: number;
  startedAt: string;
}): BlitzRunSummary {
  return {
    attemptedActions: input.attemptedActions,
    executedActions: input.executedActions,
    failedActions: input.failedActions,
    skippedActions: input.skippedActions,
    rollbackCount: input.rollbackCount,
    phaseSummaries: BLITZ_PHASE_ORDER.map((phase) => input.phaseSummaries.get(phase) ?? emptyPhaseSummary(phase)),
    startedAt: input.startedAt,
    completedAt: nowIso()
  };
}

export interface BlitzRunOrchestratorDependencies {
  repository: BlitzRunRepository;
  planner: ActionPlanner;
  executor: ActionExecutor;
  events: EventPublisher;
  options?: Partial<OrchestratorOptions>;
}

export class BlitzRunOrchestrator {
  private readonly options: OrchestratorOptions;

  constructor(private readonly deps: BlitzRunOrchestratorDependencies) {
    this.options = { ...DEFAULT_OPTIONS, ...deps.options };
  }

  async executeRun(runId: string): Promise<BlitzRun> {
    const run = await this.loadRunOrThrow(runId);
    const policy = await this.deps.repository.getAutopilotPolicy(run.clientId);
    const startedAt = nowIso();

    await this.deps.repository.setRunStatus(run.id, "running");

    const phaseSummaries = new Map<BlitzPhase, BlitzPhaseSummary>(
      BLITZ_PHASE_ORDER.map((phase) => [phase, emptyPhaseSummary(phase)])
    );

    let attemptedActions = 0;
    let executedActions = 0;
    let failedActions = 0;
    let skippedActions = 0;
    let rollbackCount = 0;
    let actionsExecutedToday = 0;
    let criticalFailures = 0;

    const executedForPotentialRollback: string[] = [];

    for (const phase of BLITZ_PHASE_ORDER) {
      await this.deps.events.publish({
        id: randomUUID(),
        type: "blitz.phase.started",
        timestamp: nowIso(),
        payload: { runId: run.id, phase }
      });

      const phaseSummary = phaseSummaries.get(phase) ?? emptyPhaseSummary(phase);
      const plannedActions = await this.deps.planner.planPhase({ run, phase, policy });

      for (const planned of plannedActions) {
        attemptedActions += 1;
        phaseSummary.attempted += 1;

        const idempotencyKey = buildActionIdempotencyKey({
          runId: run.id,
          phase: planned.phase,
          actionType: planned.actionType,
          payload: planned.payload
        });

        const existing = await this.deps.repository.findActionByIdempotencyKey(run.id, idempotencyKey);
        if (existing && existing.status === "executed") {
          phaseSummary.skipped += 1;
          skippedActions += 1;
          continue;
        }

        const policyEvaluation = evaluateActionPolicyGate({
          policy,
          action: planned,
          actionsExecutedToday,
          actionsExecutedInPhase: phaseSummary.executed + phaseSummary.failed
        });

        const createdAction = await this.deps.repository.insertAction({
          runId: run.id,
          organizationId: run.organizationId,
          clientId: run.clientId,
          phase: planned.phase,
          actionType: planned.actionType,
          riskTier: planned.riskTier,
          policyDecision: policyEvaluation.decision,
          status: policyEvaluation.allowed ? "pending" : "skipped",
          actor: planned.actor,
          idempotencyKey,
          payload: planned.payload,
          policySnapshot: run.policySnapshot
        });

        if (!policyEvaluation.allowed) {
          phaseSummary.skipped += 1;
          skippedActions += 1;

          await this.deps.repository.appendActionLog({
            runId: run.id,
            actionId: createdAction.id,
            phase,
            level: policyEvaluation.requiresEscalation ? "warn" : "info",
            message: "action skipped by policy gate",
            context: {
              reason: policyEvaluation.reason,
              decision: policyEvaluation.decision,
              requiresEscalation: policyEvaluation.requiresEscalation
            },
            createdAt: nowIso()
          });
          continue;
        }

        const throttleMs = policyEvaluation.throttleMs ?? this.options.defaultThrottleMs;
        if (throttleMs > 0) {
          await sleep(throttleMs);
        }

        try {
          const result = await this.executeActionWithRetry(run, createdAction.id, planned);
          phaseSummary.executed += 1;
          executedActions += 1;
          actionsExecutedToday += 1;

          if (ROLLBACK_ELIGIBLE_ACTIONS.has(planned.actionType)) {
            executedForPotentialRollback.push(createdAction.id);
          }

          await this.deps.repository.updateAction(createdAction.id, {
            status: "executed",
            result: result.output,
            error: null,
            executedAt: nowIso()
          });

          await this.deps.events.publish({
            id: randomUUID(),
            type: "blitz.action.executed",
            timestamp: nowIso(),
            payload: {
              runId: run.id,
              actionId: createdAction.id,
              phase
            }
          });
        } catch (error) {
          failedActions += 1;
          phaseSummary.failed += 1;

          const message = error instanceof Error ? error.message : String(error);

          await this.deps.repository.updateAction(createdAction.id, {
            status: "failed",
            error: message,
            result: null,
            executedAt: nowIso()
          });

          await this.deps.events.publish({
            id: randomUUID(),
            type: "blitz.action.failed",
            timestamp: nowIso(),
            payload: {
              runId: run.id,
              actionId: createdAction.id,
              phase,
              error: message
            }
          });

          await this.deps.repository.appendActionLog({
            runId: run.id,
            actionId: createdAction.id,
            phase,
            level: "error",
            message: "action execution failed",
            context: { error: message },
            createdAt: nowIso()
          });

          if (planned.riskTier === "critical") {
            criticalFailures += 1;
          }

          if (criticalFailures >= this.options.maxCriticalFailuresBeforeRollback) {
            rollbackCount = await this.rollbackActions(run, executedForPotentialRollback);
            const summary = toSummary({
              phaseSummaries,
              attemptedActions,
              executedActions,
              failedActions,
              skippedActions,
              rollbackCount,
              startedAt
            });

            await this.deps.repository.setRunStatus(run.id, "rolled_back", summary);
            await this.deps.events.publish({
              id: randomUUID(),
              type: "blitz.run.completed",
              timestamp: nowIso(),
              payload: {
                runId: run.id,
                organizationId: run.organizationId,
                clientId: run.clientId,
                status: "failed"
              }
            });

            return this.loadRunOrThrow(run.id);
          }
        }
      }

      phaseSummaries.set(phase, phaseSummary);
    }

    const finalStatus = failedActions === 0 ? "completed" : executedActions > 0 ? "partially_completed" : "failed";
    const summary = toSummary({
      phaseSummaries,
      attemptedActions,
      executedActions,
      failedActions,
      skippedActions,
      rollbackCount,
      startedAt
    });

    await this.deps.repository.setRunStatus(run.id, finalStatus, summary);
    await this.deps.events.publish({
      id: randomUUID(),
      type: "blitz.run.completed",
      timestamp: nowIso(),
      payload: {
        runId: run.id,
        organizationId: run.organizationId,
        clientId: run.clientId,
        status: finalStatus === "completed" ? "completed" : "failed"
      }
    });

    return this.loadRunOrThrow(run.id);
  }

  private async executeActionWithRetry(
    run: BlitzRun,
    actionId: string,
    planned: PlannedAction
  ): Promise<{ output: Record<string, unknown> }> {
    return retryWithBackoff(
      async () => {
        const action = await this.requireAction(run.id, actionId);
        const result = await this.deps.executor.execute({ run, action });
        return { output: result.output };
      },
      {
        attempts: this.options.maxActionRetries,
        baseDelayMs: 250,
        maxDelayMs: 5_000,
        onRetry: async (error, attempt, delayMs) => {
          await this.deps.repository.appendActionLog({
            runId: run.id,
            actionId,
            phase: planned.phase,
            level: "warn",
            message: "action retry scheduled",
            context: {
              attempt,
              delayMs,
              error: error instanceof Error ? error.message : String(error)
            },
            createdAt: nowIso()
          });
        }
      }
    );
  }

  private async rollbackActions(run: BlitzRun, actionIds: string[]): Promise<number> {
    if (!this.deps.executor.rollback) {
      return 0;
    }

    let rollbackCount = 0;

    for (const actionId of [...actionIds].reverse()) {
      const action = await this.requireAction(run.id, actionId);
      try {
        const rollback = await this.deps.executor.rollback({ run, action });
        await this.deps.repository.updateAction(action.id, {
          status: "rolled_back",
          result: {
            ...(action.result ?? {}),
            rollback: rollback.output
          },
          rolledBackAt: nowIso()
        });

        await this.deps.repository.createRollback({
          runId: run.id,
          actionId: action.id,
          reason: "critical_failure_threshold_reached",
          createdAt: nowIso()
        });

        rollbackCount += 1;
      } catch (error) {
        await this.deps.repository.appendActionLog({
          runId: run.id,
          actionId,
          phase: action.phase,
          level: "error",
          message: "rollback failed",
          context: {
            error: error instanceof Error ? error.message : String(error)
          },
          createdAt: nowIso()
        });
      }
    }

    return rollbackCount;
  }

  private async loadRunOrThrow(runId: string): Promise<BlitzRun> {
    const run = await this.deps.repository.getRun(runId);
    if (!run) {
      throw new Error(`run not found: ${runId}`);
    }
    return run;
  }

  private async requireAction(runId: string, actionId: string) {
    const actions = await this.deps.repository.listActions(runId);
    const action = actions.find((item) => item.id === actionId);
    if (!action) {
      throw new Error(`action not found: ${actionId}`);
    }
    return action;
  }
}
