import type { SupabaseClient } from "@supabase/supabase-js";
import { transitionRunStatus } from "@trd-aiblitz/domain";
import type {
  BlitzAction,
  BlitzActionType,
  BlitzAutopilotPolicy,
  BlitzRun,
  BlitzRunSummary
} from "@trd-aiblitz/domain";
import type {
  ActionLogRecord,
  BlitzRunRepository,
  IntegrationConnectionPatch,
  IntegrationConnectionRecord,
  RollbackRecord
} from "../types";

function nowIso(): string {
  return new Date().toISOString();
}

function numberValue(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toIsoOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function defaultPolicy(clientId: string): BlitzAutopilotPolicy {
  return {
    clientId,
    maxDailyActionsPerLocation: 150,
    maxActionsPerPhase: 40,
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
    updatedAt: nowIso()
  };
}

function mapRunRow(row: Record<string, unknown>): BlitzRun {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    clientId: String(row.client_id),
    status: String(row.status) as BlitzRun["status"],
    startedAt: toIsoOrNull(row.started_at),
    completedAt: toIsoOrNull(row.completed_at),
    createdBy: String(row.triggered_by),
    createdAt: String(row.created_at),
    policySnapshot: (row.policy_snapshot as Record<string, unknown> | null) ?? {},
    summary: (row.summary as Record<string, unknown> | null) ?? null
  };
}

function mapActionRow(row: Record<string, unknown>): BlitzAction {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    organizationId: String(row.organization_id),
    clientId: String(row.client_id),
    phase: String(row.phase) as BlitzAction["phase"],
    actionType: String(row.action_type) as BlitzActionType,
    riskTier: String(row.risk_tier) as BlitzAction["riskTier"],
    policyDecision: String(row.policy_decision) as BlitzAction["policyDecision"],
    status: String(row.status) as BlitzAction["status"],
    actor: String(row.actor) as BlitzAction["actor"],
    idempotencyKey: String(row.idempotency_key),
    payload: (row.payload as Record<string, unknown> | null) ?? {},
    policySnapshot: (row.policy_snapshot as Record<string, unknown> | null) ?? {},
    result: (row.result as Record<string, unknown> | null) ?? null,
    error: typeof row.error === "string" ? row.error : null,
    createdAt: String(row.created_at),
    executedAt: toIsoOrNull(row.executed_at),
    rolledBackAt: toIsoOrNull(row.rolled_back_at)
  };
}

function mapIntegrationConnectionRow(row: Record<string, unknown>): IntegrationConnectionRecord {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    clientId: String(row.client_id),
    provider: String(row.provider) as IntegrationConnectionRecord["provider"],
    providerAccountId: String(row.provider_account_id),
    scopes: Array.isArray(row.scopes) ? row.scopes.map(String) : [],
    encryptedTokenPayload: (row.encrypted_token_payload as Record<string, unknown> | null) ?? {},
    metadata: (row.metadata as Record<string, unknown> | null) ?? {},
    tokenExpiresAt: toIsoOrNull(row.token_expires_at),
    connectedAt: String(row.connected_at ?? row.created_at ?? nowIso()),
    lastRefreshAt: toIsoOrNull(row.last_refresh_at),
    isActive: row.is_active !== false,
    createdAt: String(row.created_at ?? nowIso()),
    updatedAt: String(row.updated_at ?? nowIso())
  };
}

export class SupabaseBlitzRepository implements BlitzRunRepository {
  private readonly runIdentityCache = new Map<string, { organizationId: string; clientId: string }>();

  constructor(private readonly supabase: SupabaseClient) {}

  async getRun(runId: string): Promise<BlitzRun | null> {
    const { data, error } = await this.supabase
      .from("blitz_runs")
      .select(
        "id,organization_id,client_id,status,started_at,completed_at,triggered_by,created_at,policy_snapshot,summary"
      )
      .eq("id", runId)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to read run ${runId}: ${error.message}`);
    }
    if (!data) {
      return null;
    }

    const run = mapRunRow(data as Record<string, unknown>);
    this.runIdentityCache.set(run.id, {
      organizationId: run.organizationId,
      clientId: run.clientId
    });
    return run;
  }

  async listActions(runId: string): Promise<BlitzAction[]> {
    const { data, error } = await this.supabase
      .from("blitz_actions")
      .select(
        "id,run_id,organization_id,client_id,phase,action_type,risk_tier,policy_decision,status,actor,idempotency_key,payload,policy_snapshot,result,error,created_at,executed_at,rolled_back_at"
      )
      .eq("run_id", runId)
      .order("created_at", { ascending: true });
    if (error) {
      throw new Error(`Failed to list run actions ${runId}: ${error.message}`);
    }
    return (data ?? []).map((row) => mapActionRow(row as Record<string, unknown>));
  }

  async findActionByIdempotencyKey(runId: string, idempotencyKey: string): Promise<BlitzAction | null> {
    const { data, error } = await this.supabase
      .from("blitz_actions")
      .select(
        "id,run_id,organization_id,client_id,phase,action_type,risk_tier,policy_decision,status,actor,idempotency_key,payload,policy_snapshot,result,error,created_at,executed_at,rolled_back_at"
      )
      .eq("run_id", runId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to find idempotent action ${idempotencyKey}: ${error.message}`);
    }
    return data ? mapActionRow(data as Record<string, unknown>) : null;
  }

  async insertAction(input: {
    runId: string;
    organizationId: string;
    clientId: string;
    phase: BlitzAction["phase"];
    actionType: BlitzAction["actionType"];
    riskTier: BlitzAction["riskTier"];
    policyDecision: BlitzAction["policyDecision"];
    status: BlitzAction["status"];
    actor: "system" | "user" | "operator";
    idempotencyKey: string;
    payload: Record<string, unknown>;
    policySnapshot: Record<string, unknown>;
  }): Promise<BlitzAction> {
    const { data, error } = await this.supabase
      .from("blitz_actions")
      .insert({
        run_id: input.runId,
        organization_id: input.organizationId,
        client_id: input.clientId,
        phase: input.phase,
        action_type: input.actionType,
        risk_tier: input.riskTier,
        policy_decision: input.policyDecision,
        status: input.status,
        actor: input.actor,
        idempotency_key: input.idempotencyKey,
        payload: input.payload,
        policy_snapshot: input.policySnapshot
      })
      .select(
        "id,run_id,organization_id,client_id,phase,action_type,risk_tier,policy_decision,status,actor,idempotency_key,payload,policy_snapshot,result,error,created_at,executed_at,rolled_back_at"
      )
      .single();
    if (error || !data) {
      throw new Error(`Failed to insert action for run ${input.runId}: ${error?.message ?? "unknown error"}`);
    }
    return mapActionRow(data as Record<string, unknown>);
  }

  async updateAction(
    actionId: string,
    patch: Partial<Pick<BlitzAction, "status" | "policyDecision" | "result" | "error" | "executedAt" | "rolledBackAt">>
  ): Promise<BlitzAction | null> {
    const updatePatch: Record<string, unknown> = {};
    if (patch.status) {
      updatePatch.status = patch.status;
    }
    if (patch.policyDecision) {
      updatePatch.policy_decision = patch.policyDecision;
    }
    if (patch.result !== undefined) {
      updatePatch.result = patch.result;
    }
    if (patch.error !== undefined) {
      updatePatch.error = patch.error;
    }
    if (patch.executedAt !== undefined) {
      updatePatch.executed_at = patch.executedAt;
    }
    if (patch.rolledBackAt !== undefined) {
      updatePatch.rolled_back_at = patch.rolledBackAt;
    }

    const { data, error } = await this.supabase
      .from("blitz_actions")
      .update(updatePatch)
      .eq("id", actionId)
      .select(
        "id,run_id,organization_id,client_id,phase,action_type,risk_tier,policy_decision,status,actor,idempotency_key,payload,policy_snapshot,result,error,created_at,executed_at,rolled_back_at"
      )
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to update action ${actionId}: ${error.message}`);
    }
    return data ? mapActionRow(data as Record<string, unknown>) : null;
  }

  async getAutopilotPolicy(clientId: string): Promise<BlitzAutopilotPolicy> {
    const { data, error } = await this.supabase
      .from("autopilot_policies")
      .select(
        "client_id,max_daily_actions_per_location,max_actions_per_phase,min_cooldown_minutes,deny_critical_without_escalation,enabled_action_types,review_reply_all_ratings_enabled,updated_at"
      )
      .eq("client_id", clientId)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to read autopilot policy for ${clientId}: ${error.message}`);
    }

    if (!data) {
      const seeded = defaultPolicy(clientId);
      const { error: insertError } = await this.supabase.from("autopilot_policies").insert({
        client_id: seeded.clientId,
        max_daily_actions_per_location: seeded.maxDailyActionsPerLocation,
        max_actions_per_phase: seeded.maxActionsPerPhase,
        min_cooldown_minutes: seeded.minCooldownMinutes,
        deny_critical_without_escalation: seeded.denyCriticalWithoutEscalation,
        enabled_action_types: seeded.enabledActionTypes,
        review_reply_all_ratings_enabled: seeded.reviewReplyAllRatingsEnabled
      });
      if (insertError) {
        throw new Error(`Failed to seed autopilot policy for ${clientId}: ${insertError.message}`);
      }
      return seeded;
    }

    return {
      clientId: String(data.client_id),
      maxDailyActionsPerLocation: numberValue(data.max_daily_actions_per_location),
      maxActionsPerPhase: numberValue(data.max_actions_per_phase),
      minCooldownMinutes: numberValue(data.min_cooldown_minutes),
      denyCriticalWithoutEscalation: Boolean(data.deny_critical_without_escalation),
      enabledActionTypes: Array.isArray(data.enabled_action_types)
        ? data.enabled_action_types.map((value) => String(value) as BlitzActionType)
        : defaultPolicy(clientId).enabledActionTypes,
      reviewReplyAllRatingsEnabled: Boolean(data.review_reply_all_ratings_enabled),
      updatedAt: String(data.updated_at ?? nowIso())
    };
  }

  async setRunStatus(runId: string, status: BlitzRun["status"], summary?: BlitzRunSummary): Promise<BlitzRun | null> {
    const current = await this.getRun(runId);
    if (!current) {
      return null;
    }

    const transitioned = transitionRunStatus(current, status, nowIso());
    const { data, error } = await this.supabase
      .from("blitz_runs")
      .update({
        status: transitioned.status,
        started_at: transitioned.startedAt,
        completed_at: transitioned.completedAt,
        summary: summary ? (summary as unknown as Record<string, unknown>) : transitioned.summary
      })
      .eq("id", runId)
      .select(
        "id,organization_id,client_id,status,started_at,completed_at,triggered_by,created_at,policy_snapshot,summary"
      )
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to update run status ${runId}: ${error.message}`);
    }
    return data ? mapRunRow(data as Record<string, unknown>) : null;
  }

  async appendActionLog(log: ActionLogRecord): Promise<void> {
    const identity = await this.getRunIdentity(log.runId);
    const { error } = await this.supabase.from("blitz_action_logs").insert({
      organization_id: identity.organizationId,
      client_id: identity.clientId,
      run_id: log.runId,
      action_id: log.actionId,
      level: log.level,
      message: log.message,
      context: log.context,
      created_at: log.createdAt
    });
    if (error) {
      throw new Error(`Failed to append action log for run ${log.runId}: ${error.message}`);
    }
  }

  async createRollback(record: RollbackRecord): Promise<void> {
    const { data: action, error: actionError } = await this.supabase
      .from("blitz_actions")
      .select("organization_id,client_id")
      .eq("id", record.actionId)
      .maybeSingle();
    if (actionError || !action) {
      throw new Error(`Failed to resolve rollback action ${record.actionId}: ${actionError?.message ?? "not found"}`);
    }

    const { error } = await this.supabase.from("blitz_rollbacks").insert({
      organization_id: action.organization_id,
      client_id: action.client_id,
      run_id: record.runId,
      action_id: record.actionId,
      initiated_by: "system",
      reason: record.reason,
      status: "completed",
      completed_at: record.createdAt,
      created_at: record.createdAt
    });
    if (error) {
      throw new Error(`Failed to insert rollback record for ${record.actionId}: ${error.message}`);
    }
  }

  async getActiveIntegrationConnection(
    clientId: string,
    provider: IntegrationConnectionRecord["provider"]
  ): Promise<IntegrationConnectionRecord | null> {
    const { data, error } = await this.supabase
      .from("integration_connections")
      .select(
        "id,organization_id,client_id,provider,provider_account_id,scopes,encrypted_token_payload,metadata,token_expires_at,connected_at,last_refresh_at,is_active,created_at,updated_at"
      )
      .eq("client_id", clientId)
      .eq("provider", provider)
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to load integration connection for client ${clientId}: ${error.message}`);
    }
    if (!data) {
      return null;
    }
    return mapIntegrationConnectionRow(data as Record<string, unknown>);
  }

  async updateIntegrationConnection(connectionId: string, patch: IntegrationConnectionPatch): Promise<void> {
    const updatePatch: Record<string, unknown> = {};
    if (patch.providerAccountId !== undefined) {
      updatePatch.provider_account_id = patch.providerAccountId;
    }
    if (patch.scopes !== undefined) {
      updatePatch.scopes = patch.scopes;
    }
    if (patch.encryptedTokenPayload !== undefined) {
      updatePatch.encrypted_token_payload = patch.encryptedTokenPayload;
    }
    if (patch.metadata !== undefined) {
      updatePatch.metadata = patch.metadata;
    }
    if (patch.tokenExpiresAt !== undefined) {
      updatePatch.token_expires_at = patch.tokenExpiresAt;
    }
    if (patch.lastRefreshAt !== undefined) {
      updatePatch.last_refresh_at = patch.lastRefreshAt;
    }
    if (patch.isActive !== undefined) {
      updatePatch.is_active = patch.isActive;
    }

    if (!Object.keys(updatePatch).length) {
      return;
    }

    const { error } = await this.supabase.from("integration_connections").update(updatePatch).eq("id", connectionId);
    if (error) {
      throw new Error(`Failed to update integration connection ${connectionId}: ${error.message}`);
    }
  }

  private async getRunIdentity(runId: string): Promise<{ organizationId: string; clientId: string }> {
    const cached = this.runIdentityCache.get(runId);
    if (cached) {
      return cached;
    }

    const { data, error } = await this.supabase
      .from("blitz_runs")
      .select("organization_id,client_id")
      .eq("id", runId)
      .maybeSingle();
    if (error || !data) {
      throw new Error(`Failed to resolve run identity for ${runId}: ${error?.message ?? "not found"}`);
    }

    const identity = {
      organizationId: String(data.organization_id),
      clientId: String(data.client_id)
    };
    this.runIdentityCache.set(runId, identity);
    return identity;
  }
}
