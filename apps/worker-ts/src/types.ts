import type {
  AiblitzEvent,
  BlitzAction,
  BlitzActionStatus,
  BlitzActionType,
  BlitzAutopilotPolicy,
  BlitzPhase,
  BlitzRun,
  BlitzRunStatus,
  BlitzRunSummary,
  PolicyDecision,
  RiskTier
} from "@trd-aiblitz/domain";

export interface PlannedAction {
  phase: BlitzPhase;
  actionType: BlitzActionType;
  riskTier: RiskTier;
  actor: "system" | "user" | "operator";
  payload: Record<string, unknown>;
  isReviewActionForAllRatings?: boolean;
}

export interface ActionExecutionResult {
  externalId?: string;
  output: Record<string, unknown>;
}

export interface ActionExecutor {
  execute(input: {
    run: BlitzRun;
    action: BlitzAction;
  }): Promise<ActionExecutionResult>;
  rollback?(input: { run: BlitzRun; action: BlitzAction }): Promise<{ output: Record<string, unknown> }>;
}

export interface ActionPlanner {
  planPhase(input: {
    run: BlitzRun;
    phase: BlitzPhase;
    policy: BlitzAutopilotPolicy;
  }): Promise<PlannedAction[]>;
}

export interface EventPublisher {
  publish(event: AiblitzEvent): Promise<void>;
}

export interface ActionLogRecord {
  runId: string;
  actionId: string | null;
  phase: BlitzPhase;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  context: Record<string, unknown>;
  createdAt: string;
}

export interface RollbackRecord {
  runId: string;
  actionId: string;
  reason: string;
  createdAt: string;
}

export interface BlitzRunRepository {
  getRun(runId: string): Promise<BlitzRun | null>;
  listActions(runId: string): Promise<BlitzAction[]>;
  findActionByIdempotencyKey(runId: string, idempotencyKey: string): Promise<BlitzAction | null>;
  insertAction(input: {
    runId: string;
    organizationId: string;
    clientId: string;
    phase: BlitzPhase;
    actionType: BlitzActionType;
    riskTier: RiskTier;
    policyDecision: PolicyDecision;
    status: BlitzActionStatus;
    actor: "system" | "user" | "operator";
    idempotencyKey: string;
    payload: Record<string, unknown>;
    policySnapshot: Record<string, unknown>;
  }): Promise<BlitzAction>;
  updateAction(
    actionId: string,
    patch: Partial<Pick<BlitzAction, "status" | "policyDecision" | "result" | "error" | "executedAt" | "rolledBackAt">>
  ): Promise<BlitzAction | null>;
  getAutopilotPolicy(clientId: string): Promise<BlitzAutopilotPolicy>;
  setRunStatus(runId: string, status: BlitzRunStatus, summary?: BlitzRunSummary): Promise<BlitzRun | null>;
  appendActionLog(log: ActionLogRecord): Promise<void>;
  createRollback(record: RollbackRecord): Promise<void>;
}

export interface OrchestratorOptions {
  maxActionRetries: number;
  maxCriticalFailuresBeforeRollback: number;
  defaultThrottleMs: number;
}
