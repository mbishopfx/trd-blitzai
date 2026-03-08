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

export interface IntegrationConnectionRecord {
  id: string;
  organizationId: string;
  clientId: string;
  provider: "gbp" | "ga4" | "google_ads" | "search_console" | "ghl";
  providerAccountId: string;
  scopes: string[];
  encryptedTokenPayload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  tokenExpiresAt: string | null;
  connectedAt: string;
  lastRefreshAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationConnectionPatch {
  providerAccountId?: string;
  scopes?: string[];
  encryptedTokenPayload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  tokenExpiresAt?: string | null;
  lastRefreshAt?: string | null;
  isActive?: boolean;
}

export interface ClientOrchestrationSettingsRecord {
  clientId: string;
  organizationId: string;
  tone: string;
  objectives: string[];
  photoAssetUrls: string[];
  photoAssetIds: string[];
  sitemapUrl: string | null;
  defaultPostUrl: string | null;
  reviewReplyStyle: string;
  postFrequencyPerWeek: number;
  postWordCountMin: number;
  postWordCountMax: number;
  eeatStructuredSnippetEnabled: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ClientMediaAssetRecord {
  id: string;
  organizationId: string;
  clientId: string;
  storageBucket: string;
  storagePath: string;
  fileName: string;
  mimeType: string | null;
  bytes: number | null;
  isAllowedForPosts: boolean;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewReplyHistoryRecord {
  organizationId: string;
  clientId: string;
  runId?: string | null;
  locationId: string;
  reviewId: string;
  reviewRating: number;
  reviewText: string;
  replyText: string;
  replyStatus: "pending" | "posted" | "failed" | "escalated";
  error?: string | null;
}

export interface ContentArtifactRecord {
  organizationId: string;
  clientId: string;
  runId?: string | null;
  phase: BlitzPhase;
  channel?: string;
  title?: string | null;
  body: string;
  metadata?: Record<string, unknown>;
  status?: "draft" | "scheduled" | "published" | "failed";
  scheduledFor?: string | null;
  publishedAt?: string | null;
}

export interface ActionNeededRecord {
  id: string;
  organizationId: string;
  clientId: string;
  runId: string | null;
  sourceActionId: string | null;
  provider: "gbp" | "ga4" | "google_ads" | "search_console" | "ghl";
  locationName: string | null;
  locationId: string | null;
  actionType: "profile_patch" | "media_upload" | "post_publish" | "review_reply" | "hours_update" | "attribute_update";
  riskTier: "low" | "medium" | "high" | "critical";
  title: string;
  description: string | null;
  status: "pending" | "approved" | "executed" | "failed" | "dismissed" | "manual_completed";
  fingerprint: string | null;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  approvedBy: string | null;
  approvedAt: string | null;
  executedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateActionNeededInput {
  organizationId: string;
  clientId: string;
  runId?: string | null;
  sourceActionId?: string | null;
  provider: "gbp" | "ga4" | "google_ads" | "search_console" | "ghl";
  locationName?: string | null;
  locationId?: string | null;
  actionType: "profile_patch" | "media_upload" | "post_publish" | "review_reply" | "hours_update" | "attribute_update";
  riskTier: "low" | "medium" | "high" | "critical";
  title: string;
  description?: string | null;
  fingerprint?: string | null;
  payload?: Record<string, unknown>;
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
  getActiveIntegrationConnection(
    clientId: string,
    provider: IntegrationConnectionRecord["provider"]
  ): Promise<IntegrationConnectionRecord | null>;
  updateIntegrationConnection(connectionId: string, patch: IntegrationConnectionPatch): Promise<void>;
  getClientOrchestrationSettings(clientId: string): Promise<ClientOrchestrationSettingsRecord>;
  listClientMediaAssets(clientId: string): Promise<ClientMediaAssetRecord[]>;
  hasPostedReplyHistory(clientId: string, reviewId: string): Promise<boolean>;
  recordReviewReplyHistory(input: ReviewReplyHistoryRecord): Promise<void>;
  createContentArtifact(input: ContentArtifactRecord): Promise<void>;
  createActionNeeded(input: CreateActionNeededInput): Promise<ActionNeededRecord>;
  listIntegrationConnections?(clientId: string): Promise<IntegrationConnectionRecord[]>;
  listDueContentArtifacts?(limit: number): Promise<Array<ContentArtifactRecord & { id: string }>>;
  updateContentArtifact?(
    artifactId: string,
    patch: Partial<Pick<ContentArtifactRecord, "status" | "metadata" | "scheduledFor" | "publishedAt">>
  ): Promise<void>;
}

export interface OrchestratorOptions {
  maxActionRetries: number;
  maxCriticalFailuresBeforeRollback: number;
  defaultThrottleMs: number;
}
