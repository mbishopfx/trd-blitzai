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
  ActionNeededRecord,
  ActionLogRecord,
  BlitzRunRepository,
  ClientMediaAssetRecord,
  ClientOrchestrationSettingsRecord,
  CreateActionNeededInput,
  IntegrationConnectionPatch,
  IntegrationConnectionRecord,
  ReviewReplyHistoryRecord,
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

function mapClientOrchestrationSettingsRow(row: Record<string, unknown>): ClientOrchestrationSettingsRecord {
  const frequencyRaw = row.post_frequency_per_week;
  const wordMinRaw = row.post_word_count_min;
  const wordMaxRaw = row.post_word_count_max;
  return {
    clientId: String(row.client_id),
    organizationId: String(row.organization_id),
    tone: typeof row.tone === "string" ? row.tone : "professional-local-expert",
    objectives: Array.isArray(row.objectives) ? row.objectives.map(String) : [],
    photoAssetUrls: Array.isArray(row.photo_asset_urls) ? row.photo_asset_urls.map(String) : [],
    photoAssetIds: Array.isArray(row.photo_asset_ids) ? row.photo_asset_ids.map(String) : [],
    sitemapUrl: typeof row.sitemap_url === "string" ? row.sitemap_url : null,
    defaultPostUrl: typeof row.default_post_url === "string" ? row.default_post_url : null,
    reviewReplyStyle: typeof row.review_reply_style === "string" ? row.review_reply_style : "balanced",
    postFrequencyPerWeek:
      frequencyRaw === undefined || frequencyRaw === null ? 3 : numberValue(frequencyRaw),
    postWordCountMin: wordMinRaw === undefined || wordMinRaw === null ? 500 : numberValue(wordMinRaw),
    postWordCountMax: wordMaxRaw === undefined || wordMaxRaw === null ? 800 : numberValue(wordMaxRaw),
    eeatStructuredSnippetEnabled: row.eeat_structured_snippet_enabled !== false,
    metadata: (row.metadata as Record<string, unknown> | null) ?? {},
    createdAt: String(row.created_at ?? nowIso()),
    updatedAt: String(row.updated_at ?? nowIso())
  };
}

function mapClientMediaAssetRow(row: Record<string, unknown>): ClientMediaAssetRecord {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    clientId: String(row.client_id),
    storageBucket: String(row.storage_bucket),
    storagePath: String(row.storage_path),
    fileName: String(row.file_name),
    mimeType: typeof row.mime_type === "string" ? row.mime_type : null,
    bytes: row.bytes === null || row.bytes === undefined ? null : numberValue(row.bytes),
    isAllowedForPosts: row.is_allowed_for_posts !== false,
    tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
    metadata: (row.metadata as Record<string, unknown> | null) ?? {},
    createdAt: String(row.created_at ?? nowIso()),
    updatedAt: String(row.updated_at ?? nowIso())
  };
}

function mapActionNeededRow(row: Record<string, unknown>): ActionNeededRecord {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    clientId: String(row.client_id),
    runId: typeof row.run_id === "string" ? row.run_id : null,
    sourceActionId: typeof row.source_action_id === "string" ? row.source_action_id : null,
    provider: String(row.provider) as ActionNeededRecord["provider"],
    locationName: typeof row.location_name === "string" ? row.location_name : null,
    locationId: typeof row.location_id === "string" ? row.location_id : null,
    actionType: String(row.action_type) as ActionNeededRecord["actionType"],
    riskTier: String(row.risk_tier) as ActionNeededRecord["riskTier"],
    title: String(row.title),
    description: typeof row.description === "string" ? row.description : null,
    status: String(row.status) as ActionNeededRecord["status"],
    fingerprint: typeof row.fingerprint === "string" ? row.fingerprint : null,
    payload: (row.payload as Record<string, unknown> | null) ?? {},
    result: (row.result as Record<string, unknown> | null) ?? {},
    approvedBy: typeof row.approved_by === "string" ? row.approved_by : null,
    approvedAt: toIsoOrNull(row.approved_at),
    executedAt: toIsoOrNull(row.executed_at),
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
      const { data: clientRow, error: clientError } = await this.supabase
        .from("clients")
        .select("organization_id")
        .eq("id", clientId)
        .maybeSingle();
      if (clientError || !clientRow) {
        throw new Error(
          `Failed to resolve client organization for autopilot policy seed ${clientId}: ${clientError?.message ?? "client not found"}`
        );
      }

      const { error: insertError } = await this.supabase.from("autopilot_policies").insert({
        organization_id: String(clientRow.organization_id),
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

  async getClientOrchestrationSettings(clientId: string): Promise<ClientOrchestrationSettingsRecord> {
    const { data: row, error } = await this.supabase
      .from("client_orchestration_settings")
      .select(
        "client_id,organization_id,tone,objectives,photo_asset_urls,photo_asset_ids,sitemap_url,default_post_url,review_reply_style,post_frequency_per_week,post_word_count_min,post_word_count_max,eeat_structured_snippet_enabled,metadata,created_at,updated_at"
      )
      .eq("client_id", clientId)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to load orchestration settings for client ${clientId}: ${error.message}`);
    }

    if (!row) {
      const { data: clientRow, error: clientError } = await this.supabase
        .from("clients")
        .select("organization_id")
        .eq("id", clientId)
        .maybeSingle();
      if (clientError || !clientRow) {
        throw new Error(
          `Failed to resolve client organization for orchestration settings ${clientId}: ${clientError?.message ?? "client not found"}`
        );
      }

      const { data: seededRow, error: seedError } = await this.supabase
        .from("client_orchestration_settings")
        .insert({
          organization_id: String(clientRow.organization_id),
          client_id: clientId,
          tone: "professional-local-expert",
          objectives: [
            "Increase local visibility",
            "Improve review response velocity",
            "Publish location-aware GBP content consistently"
          ],
          photo_asset_urls: [],
          photo_asset_ids: [],
          sitemap_url: null,
          default_post_url: null,
          review_reply_style: "balanced",
          post_frequency_per_week: 3,
          post_word_count_min: 500,
          post_word_count_max: 800,
          eeat_structured_snippet_enabled: true,
          metadata: {}
        })
        .select(
          "client_id,organization_id,tone,objectives,photo_asset_urls,photo_asset_ids,sitemap_url,default_post_url,review_reply_style,post_frequency_per_week,post_word_count_min,post_word_count_max,eeat_structured_snippet_enabled,metadata,created_at,updated_at"
        )
        .single();
      if (seedError || !seededRow) {
        throw new Error(`Failed to seed orchestration settings for client ${clientId}: ${seedError?.message ?? "unknown error"}`);
      }

      return mapClientOrchestrationSettingsRow(seededRow as Record<string, unknown>);
    }

    return mapClientOrchestrationSettingsRow(row as Record<string, unknown>);
  }

  async listClientMediaAssets(clientId: string): Promise<ClientMediaAssetRecord[]> {
    const { data: rows, error } = await this.supabase
      .from("client_media_assets")
      .select(
        "id,organization_id,client_id,storage_bucket,storage_path,file_name,mime_type,bytes,is_allowed_for_posts,tags,metadata,created_at,updated_at"
      )
      .eq("client_id", clientId)
      .eq("is_allowed_for_posts", true)
      .order("created_at", { ascending: false });
    if (error) {
      throw new Error(`Failed to load client media assets for ${clientId}: ${error.message}`);
    }

    const mapped = (rows ?? []).map((row) => mapClientMediaAssetRow(row as Record<string, unknown>));
    const withSignedUrls = await Promise.all(
      mapped.map(async (asset) => {
        const { data } = await this.supabase.storage
          .from(asset.storageBucket)
          .createSignedUrl(asset.storagePath, 60 * 60 * 24 * 30);
        return {
          ...asset,
          metadata: {
            ...asset.metadata,
            signedUrl: data?.signedUrl ?? null
          }
        };
      })
    );
    return withSignedUrls;
  }

  async hasPostedReplyHistory(clientId: string, reviewId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from("review_reply_history")
      .select("id")
      .eq("client_id", clientId)
      .eq("review_id", reviewId)
      .eq("reply_status", "posted")
      .limit(1)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to query review reply history for ${reviewId}: ${error.message}`);
    }

    return Boolean(data);
  }

  async recordReviewReplyHistory(input: ReviewReplyHistoryRecord): Promise<void> {
    const { error } = await this.supabase.from("review_reply_history").upsert(
      {
        organization_id: input.organizationId,
        client_id: input.clientId,
        location_id: input.locationId,
        review_id: input.reviewId,
        review_rating: input.reviewRating,
        review_text: input.reviewText,
        reply_text: input.replyText,
        reply_status: input.replyStatus,
        replied_at: input.replyStatus === "posted" ? nowIso() : null,
        error: input.error ?? null,
        source_payload: {
          source: "blitz_worker_live",
          updatedAt: nowIso()
        }
      },
      { onConflict: "client_id,review_id" }
    );
    if (error) {
      throw new Error(`Failed to write review reply history for ${input.reviewId}: ${error.message}`);
    }
  }

  async createActionNeeded(input: CreateActionNeededInput): Promise<ActionNeededRecord> {
    if (input.fingerprint) {
      const { data: existing, error: existingError } = await this.supabase
        .from("client_actions_needed")
        .select(
          "id,organization_id,client_id,run_id,source_action_id,provider,location_name,location_id,action_type,risk_tier,title,description,status,fingerprint,payload,result,approved_by,approved_at,executed_at,created_at,updated_at"
        )
        .eq("client_id", input.clientId)
        .eq("status", "pending")
        .eq("fingerprint", input.fingerprint)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existingError) {
        throw new Error(`Failed to query existing actions-needed item: ${existingError.message}`);
      }
      if (existing) {
        return mapActionNeededRow(existing as Record<string, unknown>);
      }
    }

    const { data: inserted, error } = await this.supabase
      .from("client_actions_needed")
      .insert({
        organization_id: input.organizationId,
        client_id: input.clientId,
        run_id: input.runId ?? null,
        source_action_id: input.sourceActionId ?? null,
        provider: input.provider,
        location_name: input.locationName ?? null,
        location_id: input.locationId ?? null,
        action_type: input.actionType,
        risk_tier: input.riskTier,
        title: input.title,
        description: input.description ?? null,
        status: "pending",
        fingerprint: input.fingerprint ?? null,
        payload: input.payload ?? {},
        result: {}
      })
      .select(
        "id,organization_id,client_id,run_id,source_action_id,provider,location_name,location_id,action_type,risk_tier,title,description,status,fingerprint,payload,result,approved_by,approved_at,executed_at,created_at,updated_at"
      )
      .single();
    if (error || !inserted) {
      throw new Error(`Failed to insert actions-needed item: ${error?.message ?? "unknown error"}`);
    }

    return mapActionNeededRow(inserted as Record<string, unknown>);
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
