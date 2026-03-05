import { randomUUID } from "node:crypto";
import { transitionRunStatus } from "@trd-aiblitz/domain";
import type {
  BlitzAction,
  BlitzAutopilotPolicy,
  BlitzRun,
  BlitzRunSummary,
  BlitzRunStatus,
  PolicyDecision
} from "@trd-aiblitz/domain";
import type {
  ActionNeededRecord,
  ActionLogRecord,
  BlitzRunRepository,
  ClientMediaAssetRecord,
  CreateActionNeededInput,
  ClientOrchestrationSettingsRecord,
  IntegrationConnectionPatch,
  IntegrationConnectionRecord,
  ReviewReplyHistoryRecord,
  RollbackRecord
} from "../types";

interface InMemoryState {
  runs: Map<string, BlitzRun>;
  actions: Map<string, BlitzAction>;
  policies: Map<string, BlitzAutopilotPolicy>;
  orchestrationSettings: Map<string, ClientOrchestrationSettingsRecord>;
  mediaAssets: Map<string, ClientMediaAssetRecord>;
  actionsNeeded: Map<string, ActionNeededRecord>;
  reviewReplies: Map<string, ReviewReplyHistoryRecord>;
  logs: ActionLogRecord[];
  rollbacks: RollbackRecord[];
  integrations: Map<string, IntegrationConnectionRecord>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function defaultPolicy(clientId: string): BlitzAutopilotPolicy {
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
    updatedAt: nowIso()
  };
}

function defaultOrchestrationSettings(clientId: string): ClientOrchestrationSettingsRecord {
  return {
    clientId,
    organizationId: "demo-org",
    tone: "professional-local-expert",
    objectives: [
      "Increase local visibility",
      "Improve review response velocity",
      "Publish location-aware GBP content consistently"
    ],
    photoAssetUrls: [],
    photoAssetIds: [],
    sitemapUrl: null,
    defaultPostUrl: null,
    reviewReplyStyle: "balanced",
    postFrequencyPerWeek: 3,
    postWordCountMin: 500,
    postWordCountMax: 800,
    eeatStructuredSnippetEnabled: true,
    metadata: {},
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

export class InMemoryBlitzRepository implements BlitzRunRepository {
  private readonly state: InMemoryState;

  constructor(seed?: {
    runs?: BlitzRun[];
    policies?: BlitzAutopilotPolicy[];
    integrations?: IntegrationConnectionRecord[];
    orchestrationSettings?: ClientOrchestrationSettingsRecord[];
    mediaAssets?: ClientMediaAssetRecord[];
  }) {
    this.state = {
      runs: new Map((seed?.runs ?? []).map((run) => [run.id, run])),
      actions: new Map(),
      policies: new Map((seed?.policies ?? []).map((policy) => [policy.clientId, policy])),
      orchestrationSettings: new Map(
        (seed?.orchestrationSettings ?? []).map((settings) => [settings.clientId, settings])
      ),
      mediaAssets: new Map((seed?.mediaAssets ?? []).map((asset) => [asset.id, asset])),
      actionsNeeded: new Map(),
      reviewReplies: new Map(),
      logs: [],
      rollbacks: [],
      integrations: new Map((seed?.integrations ?? []).map((connection) => [connection.id, connection]))
    };
  }

  async getRun(runId: string): Promise<BlitzRun | null> {
    return this.state.runs.get(runId) ?? null;
  }

  async listActions(runId: string): Promise<BlitzAction[]> {
    return [...this.state.actions.values()].filter((action) => action.runId === runId);
  }

  async findActionByIdempotencyKey(runId: string, idempotencyKey: string): Promise<BlitzAction | null> {
    return (
      [...this.state.actions.values()].find(
        (action) => action.runId === runId && action.idempotencyKey === idempotencyKey
      ) ?? null
    );
  }

  async insertAction(input: {
    runId: string;
    organizationId: string;
    clientId: string;
    phase: BlitzAction["phase"];
    actionType: BlitzAction["actionType"];
    riskTier: BlitzAction["riskTier"];
    policyDecision: PolicyDecision;
    status: BlitzAction["status"];
    actor: "system" | "user" | "operator";
    idempotencyKey: string;
    payload: Record<string, unknown>;
    policySnapshot: Record<string, unknown>;
  }): Promise<BlitzAction> {
    const action: BlitzAction = {
      id: randomUUID(),
      runId: input.runId,
      organizationId: input.organizationId,
      clientId: input.clientId,
      phase: input.phase,
      actionType: input.actionType,
      riskTier: input.riskTier,
      policyDecision: input.policyDecision,
      status: input.status,
      actor: input.actor,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload,
      policySnapshot: input.policySnapshot,
      result: null,
      error: null,
      createdAt: nowIso(),
      executedAt: null,
      rolledBackAt: null
    };

    this.state.actions.set(action.id, action);
    return action;
  }

  async updateAction(
    actionId: string,
    patch: Partial<Pick<BlitzAction, "status" | "policyDecision" | "result" | "error" | "executedAt" | "rolledBackAt">>
  ): Promise<BlitzAction | null> {
    const action = this.state.actions.get(actionId);
    if (!action) {
      return null;
    }

    const updated: BlitzAction = {
      ...action,
      ...patch
    };

    this.state.actions.set(actionId, updated);
    return updated;
  }

  async getAutopilotPolicy(clientId: string): Promise<BlitzAutopilotPolicy> {
    const existing = this.state.policies.get(clientId);
    if (existing) {
      return existing;
    }

    const seeded = defaultPolicy(clientId);
    this.state.policies.set(clientId, seeded);
    return seeded;
  }

  async setRunStatus(runId: string, status: BlitzRunStatus, summary?: BlitzRunSummary): Promise<BlitzRun | null> {
    const current = this.state.runs.get(runId);
    if (!current) {
      return null;
    }

    const transitioned = transitionRunStatus(current, status, nowIso());
    const updated: BlitzRun = {
      ...transitioned,
      summary: summary ? (summary as unknown as Record<string, unknown>) : transitioned.summary
    };

    this.state.runs.set(runId, updated);
    return updated;
  }

  async appendActionLog(log: ActionLogRecord): Promise<void> {
    this.state.logs.push(log);
  }

  async createRollback(record: RollbackRecord): Promise<void> {
    this.state.rollbacks.push(record);
  }

  async getActiveIntegrationConnection(
    clientId: string,
    provider: IntegrationConnectionRecord["provider"]
  ): Promise<IntegrationConnectionRecord | null> {
    const matches = [...this.state.integrations.values()].filter(
      (connection) => connection.clientId === clientId && connection.provider === provider && connection.isActive
    );

    if (!matches.length) {
      return null;
    }

    return matches.sort((a, b) => {
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    })[0];
  }

  async updateIntegrationConnection(connectionId: string, patch: IntegrationConnectionPatch): Promise<void> {
    const existing = this.state.integrations.get(connectionId);
    if (!existing) {
      throw new Error(`integration connection not found: ${connectionId}`);
    }

    const updated: IntegrationConnectionRecord = {
      ...existing,
      ...patch,
      updatedAt: nowIso()
    };
    this.state.integrations.set(connectionId, updated);
  }

  async getClientOrchestrationSettings(clientId: string): Promise<ClientOrchestrationSettingsRecord> {
    const existing = this.state.orchestrationSettings.get(clientId);
    if (existing) {
      return existing;
    }

    const seeded = defaultOrchestrationSettings(clientId);
    this.state.orchestrationSettings.set(clientId, seeded);
    return seeded;
  }

  async listClientMediaAssets(clientId: string): Promise<ClientMediaAssetRecord[]> {
    return [...this.state.mediaAssets.values()].filter((asset) => asset.clientId === clientId);
  }

  async hasPostedReplyHistory(clientId: string, reviewId: string): Promise<boolean> {
    const key = `${clientId}:${reviewId}`;
    const existing = this.state.reviewReplies.get(key);
    return existing?.replyStatus === "posted";
  }

  async recordReviewReplyHistory(input: ReviewReplyHistoryRecord): Promise<void> {
    const key = `${input.clientId}:${input.reviewId}`;
    this.state.reviewReplies.set(key, input);
  }

  async createActionNeeded(input: CreateActionNeededInput): Promise<ActionNeededRecord> {
    const record: ActionNeededRecord = {
      id: randomUUID(),
      organizationId: input.organizationId,
      clientId: input.clientId,
      runId: input.runId ?? null,
      sourceActionId: input.sourceActionId ?? null,
      provider: input.provider,
      locationName: input.locationName ?? null,
      locationId: input.locationId ?? null,
      actionType: input.actionType,
      riskTier: input.riskTier,
      title: input.title,
      description: input.description ?? null,
      status: "pending",
      fingerprint: input.fingerprint ?? null,
      payload: input.payload ?? {},
      result: {},
      approvedBy: null,
      approvedAt: null,
      executedAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    if (record.fingerprint) {
      const existing = [...this.state.actionsNeeded.values()].find(
        (entry) =>
          entry.clientId === record.clientId &&
          entry.status === "pending" &&
          entry.fingerprint === record.fingerprint
      );
      if (existing) {
        return existing;
      }
    }

    this.state.actionsNeeded.set(record.id, record);
    return record;
  }

  seedRun(run: BlitzRun): void {
    this.state.runs.set(run.id, run);
  }

  snapshot(): InMemoryState {
    return this.state;
  }
}
