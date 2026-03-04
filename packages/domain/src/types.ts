export const blitzRunStatusValues = [
  "created",
  "running",
  "completed",
  "failed",
  "partially_completed",
  "rolled_back"
] as const;

export type BlitzRunStatus = (typeof blitzRunStatusValues)[number];

export const blitzPhaseValues = [
  "preflight",
  "completeness",
  "media",
  "content",
  "reviews",
  "interaction",
  "postcheck"
] as const;

export type BlitzPhase = (typeof blitzPhaseValues)[number];

export const blitzActionTypeValues = [
  "profile_patch",
  "media_upload",
  "post_publish",
  "review_reply",
  "hours_update",
  "attribute_update"
] as const;

export type BlitzActionType = (typeof blitzActionTypeValues)[number];

export const blitzActionStatusValues = [
  "pending",
  "executed",
  "failed",
  "rolled_back",
  "skipped"
] as const;

export type BlitzActionStatus = (typeof blitzActionStatusValues)[number];

export const riskTierValues = ["low", "medium", "high", "critical"] as const;

export type RiskTier = (typeof riskTierValues)[number];

export const policyDecisionValues = [
  "allow",
  "deny",
  "allow_with_limit",
  "allow_with_escalation"
] as const;

export type PolicyDecision = (typeof policyDecisionValues)[number];

export const attributionWindowValues = ["7d", "30d", "90d"] as const;

export type AttributionWindow = (typeof attributionWindowValues)[number];

export const roleValues = ["owner", "admin", "operator", "analyst", "client_viewer"] as const;

export type OrgRole = (typeof roleValues)[number];

export interface BlitzRun {
  id: string;
  organizationId: string;
  clientId: string;
  status: BlitzRunStatus;
  startedAt: string | null;
  completedAt: string | null;
  createdBy: string;
  createdAt: string;
  policySnapshot: Record<string, unknown>;
  summary: Record<string, unknown> | null;
}

export interface BlitzAction {
  id: string;
  runId: string;
  clientId?: string;
  organizationId?: string;
  phase: BlitzPhase;
  actionType: BlitzActionType;
  riskTier: RiskTier;
  policyDecision: PolicyDecision;
  status: BlitzActionStatus;
  actor: "system" | "user" | "operator";
  idempotencyKey: string;
  payload: Record<string, unknown>;
  policySnapshot?: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  executedAt: string | null;
  rolledBackAt?: string | null;
}

export interface OrgContext {
  organizationId: string;
  userId: string;
  role: OrgRole;
}

export interface BlitzAutopilotPolicy {
  clientId: string;
  maxDailyActionsPerLocation: number;
  maxActionsPerPhase: number;
  minCooldownMinutes: number;
  denyCriticalWithoutEscalation: boolean;
  enabledActionTypes: BlitzActionType[];
  reviewReplyAllRatingsEnabled: boolean;
  updatedAt: string;
}

export interface BlitzPhaseSummary {
  phase: BlitzPhase;
  attempted: number;
  executed: number;
  failed: number;
  skipped: number;
}

export interface BlitzRunSummary {
  attemptedActions: number;
  executedActions: number;
  failedActions: number;
  skippedActions: number;
  rollbackCount: number;
  phaseSummaries: BlitzPhaseSummary[];
  startedAt: string;
  completedAt: string;
}

export interface PolicyEvaluationResult {
  decision: PolicyDecision;
  allowed: boolean;
  requiresEscalation: boolean;
  reason: string;
  throttleMs?: number;
}

export interface PolicyUsageCounters {
  actionsExecutedToday: number;
  actionsInPhase: number;
}
