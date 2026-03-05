import { randomUUID } from "node:crypto";
import type {
  BlitzAction,
  BlitzActionType,
  BlitzAutopilotPolicy,
  BlitzPhase,
  BlitzRun,
  BlitzRunStatus,
  PolicyDecision,
  RiskTier
} from "@trd-aiblitz/domain";
import type {
  BlendedDailyMetric,
  BlitzImpactSummary,
  DailyChannelMetric
} from "@trd-aiblitz/integrations-attribution";
import { normalizeDailyMetrics } from "@trd-aiblitz/integrations-attribution";
import { getSupabaseServiceClient, isSupabaseConfigured } from "./supabase";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  ownerEmail: string;
  createdAt: string;
}

export interface Client {
  id: string;
  organizationId: string;
  name: string;
  timezone: string;
  websiteUrl: string | null;
  primaryLocationLabel: string | null;
  createdAt: string;
}

export interface IntegrationConnection {
  id: string;
  organizationId: string;
  clientId: string;
  provider: "gbp" | "ga4" | "google_ads" | "ghl";
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

export interface RollbackRecord {
  id: string;
  runId: string;
  actionId: string;
  rolledBackAt: string;
  reason: string;
}

interface Store {
  organizations: Map<string, Organization>;
  clients: Map<string, Client>;
  runs: Map<string, BlitzRun>;
  actions: Map<string, BlitzAction>;
  autopilotPolicies: Map<string, BlitzAutopilotPolicy>;
  integrations: Map<string, IntegrationConnection>;
  rollbacks: Map<string, RollbackRecord>;
  attribution: DailyChannelMetric[];
}

const globalStore = globalThis as typeof globalThis & {
  __aiblitzStore?: Store;
};

const phaseToActionType: Record<BlitzPhase, BlitzActionType> = {
  preflight: "profile_patch",
  completeness: "attribute_update",
  media: "media_upload",
  content: "post_publish",
  reviews: "review_reply",
  interaction: "hours_update",
  postcheck: "profile_patch"
};

const phaseRisk: Record<BlitzPhase, RiskTier> = {
  preflight: "low",
  completeness: "medium",
  media: "low",
  content: "medium",
  reviews: "high",
  interaction: "medium",
  postcheck: "low"
};

function getStore(): Store {
  if (!globalStore.__aiblitzStore) {
    globalStore.__aiblitzStore = {
      organizations: new Map(),
      clients: new Map(),
      runs: new Map(),
      actions: new Map(),
      autopilotPolicies: new Map(),
      integrations: new Map(),
      rollbacks: new Map(),
      attribution: []
    };
  }

  return globalStore.__aiblitzStore;
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

function mapOrganizationRow(row: Record<string, unknown>): Organization {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    ownerEmail: typeof row.billing_email === "string" ? row.billing_email : "",
    createdAt: String(row.created_at)
  };
}

function mapClientRow(row: Record<string, unknown>): Client {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    name: String(row.name),
    timezone: String(row.timezone ?? "America/Chicago"),
    websiteUrl: typeof row.website_url === "string" ? row.website_url : null,
    primaryLocationLabel: typeof row.primary_location_label === "string" ? row.primary_location_label : null,
    createdAt: String(row.created_at)
  };
}

function mapRunRow(row: Record<string, unknown>): BlitzRun {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    clientId: String(row.client_id),
    status: String(row.status) as BlitzRunStatus,
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
    phase: String(row.phase) as BlitzPhase,
    actionType: String(row.action_type) as BlitzActionType,
    riskTier: String(row.risk_tier) as RiskTier,
    policyDecision: String(row.policy_decision) as PolicyDecision,
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

function mapIntegrationRow(row: Record<string, unknown>): IntegrationConnection {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    clientId: String(row.client_id),
    provider: String(row.provider) as IntegrationConnection["provider"],
    providerAccountId: String(row.provider_account_id),
    scopes: Array.isArray(row.scopes) ? row.scopes.map(String) : [],
    encryptedTokenPayload: (row.encrypted_token_payload as Record<string, unknown> | null) ?? {},
    metadata: (row.metadata as Record<string, unknown> | null) ?? {},
    tokenExpiresAt: typeof row.token_expires_at === "string" ? row.token_expires_at : null,
    connectedAt: typeof row.connected_at === "string" ? row.connected_at : String(row.created_at),
    lastRefreshAt: typeof row.last_refresh_at === "string" ? row.last_refresh_at : null,
    isActive: row.is_active !== false,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function seedRunActions(runId: string): BlitzAction[] {
  const store = getStore();
  const phases: BlitzPhase[] = [
    "preflight",
    "completeness",
    "media",
    "content",
    "reviews",
    "interaction",
    "postcheck"
  ];

  const actions = phases.map((phase) => {
    const action: BlitzAction = {
      id: randomUUID(),
      runId,
      phase,
      actionType: phaseToActionType[phase],
      riskTier: phaseRisk[phase],
      policyDecision: "allow",
      status: "pending",
      actor: "system",
      idempotencyKey: `${runId}:${phase}`,
      payload: { phase, objective: `Execute ${phase} phase` },
      result: null,
      error: null,
      createdAt: nowIso(),
      executedAt: null,
      rolledBackAt: null
    };

    store.actions.set(action.id, action);
    return action;
  });

  return actions;
}

function daysForWindow(window: "7d" | "30d" | "90d"): number {
  if (window === "7d") return 7;
  if (window === "30d") return 30;
  return 90;
}

export async function createOrganization(input: {
  name: string;
  slug: string;
  ownerEmail: string;
  ownerUserId?: string;
}): Promise<Organization> {
  if (!isSupabaseConfigured()) {
    const store = getStore();
    const id = randomUUID();
    const org: Organization = {
      id,
      name: input.name,
      slug: input.slug,
      ownerEmail: input.ownerEmail,
      createdAt: nowIso()
    };
    store.organizations.set(id, org);
    return org;
  }

  const supabase = getSupabaseServiceClient();
  const { data: orgRow, error: orgError } = await supabase
    .from("organizations")
    .insert({
      name: input.name,
      slug: input.slug,
      billing_email: input.ownerEmail
    })
    .select("id,name,slug,billing_email,created_at")
    .single();
  if (orgError || !orgRow) {
    throw new Error(`Failed to create organization: ${orgError?.message ?? "unknown error"}`);
  }

  if (input.ownerUserId) {
    const { error: membershipError } = await supabase
      .from("organization_users")
      .insert({
        organization_id: orgRow.id,
        user_id: input.ownerUserId,
        role: "owner"
      });
    if (membershipError) {
      throw new Error(`Failed to create organization owner membership: ${membershipError.message}`);
    }
  }

  return mapOrganizationRow(orgRow as Record<string, unknown>);
}

export async function listOrganizations(input?: { userId?: string }): Promise<Organization[]> {
  if (!isSupabaseConfigured()) {
    return [...getStore().organizations.values()];
  }

  const supabase = getSupabaseServiceClient();

  if (input?.userId) {
    const { data: memberships, error: membershipError } = await supabase
      .from("organization_users")
      .select("organization_id")
      .eq("user_id", input.userId);
    if (membershipError) {
      throw new Error(`Failed to load organization memberships: ${membershipError.message}`);
    }

    const ids = (memberships ?? []).map((row) => row.organization_id);
    if (!ids.length) {
      return [];
    }

    const { data: orgRows, error: orgError } = await supabase
      .from("organizations")
      .select("id,name,slug,billing_email,created_at")
      .in("id", ids);
    if (orgError) {
      throw new Error(`Failed to list organizations: ${orgError.message}`);
    }

    return (orgRows ?? []).map((row) => mapOrganizationRow(row as Record<string, unknown>));
  }

  const { data: orgRows, error: orgError } = await supabase
    .from("organizations")
    .select("id,name,slug,billing_email,created_at")
    .order("created_at", { ascending: false });
  if (orgError) {
    throw new Error(`Failed to list organizations: ${orgError.message}`);
  }

  return (orgRows ?? []).map((row) => mapOrganizationRow(row as Record<string, unknown>));
}

export async function createClient(input: {
  organizationId: string;
  name: string;
  timezone: string;
  websiteUrl?: string;
  primaryLocationLabel?: string;
}): Promise<Client> {
  if (!isSupabaseConfigured()) {
    const store = getStore();
    const id = randomUUID();
    const client: Client = {
      id,
      organizationId: input.organizationId,
      name: input.name,
      timezone: input.timezone,
      websiteUrl: input.websiteUrl ?? null,
      primaryLocationLabel: input.primaryLocationLabel ?? null,
      createdAt: nowIso()
    };
    store.clients.set(id, client);
    store.autopilotPolicies.set(id, defaultPolicy(id));
    return client;
  }

  const supabase = getSupabaseServiceClient();
  const { data: row, error } = await supabase
    .from("clients")
    .insert({
      organization_id: input.organizationId,
      name: input.name,
      timezone: input.timezone,
      website_url: input.websiteUrl ?? null,
      primary_location_label: input.primaryLocationLabel ?? null
    })
    .select("id,organization_id,name,timezone,website_url,primary_location_label,created_at")
    .single();
  if (error || !row) {
    throw new Error(`Failed to create client: ${error?.message ?? "unknown error"}`);
  }

  await getAutopilotPolicy(String(row.id));
  return mapClientRow(row as Record<string, unknown>);
}

export async function listClientsForOrg(organizationId: string): Promise<Client[]> {
  if (!isSupabaseConfigured()) {
    return [...getStore().clients.values()].filter((client) => client.organizationId === organizationId);
  }

  const supabase = getSupabaseServiceClient();
  const { data: rows, error } = await supabase
    .from("clients")
    .select("id,organization_id,name,timezone,website_url,primary_location_label,created_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (error) {
    throw new Error(`Failed to list clients: ${error.message}`);
  }

  return (rows ?? []).map((row) => mapClientRow(row as Record<string, unknown>));
}

export async function createBlitzRun(input: {
  organizationId: string;
  clientId: string;
  createdBy: string;
  policySnapshot: Record<string, unknown>;
}): Promise<BlitzRun> {
  if (!isSupabaseConfigured()) {
    const store = getStore();
    const run: BlitzRun = {
      id: randomUUID(),
      organizationId: input.organizationId,
      clientId: input.clientId,
      status: "created",
      startedAt: null,
      completedAt: null,
      createdBy: input.createdBy,
      createdAt: nowIso(),
      policySnapshot: input.policySnapshot,
      summary: null
    };

    store.runs.set(run.id, run);
    seedRunActions(run.id);
    return run;
  }

  const supabase = getSupabaseServiceClient();
  const { data: clientRow, error: clientError } = await supabase
    .from("clients")
    .select("organization_id")
    .eq("id", input.clientId)
    .maybeSingle();
  if (clientError || !clientRow) {
    throw new Error(`Failed to load client before run creation: ${clientError?.message ?? "client not found"}`);
  }
  if (String(clientRow.organization_id) !== input.organizationId) {
    throw new Error("Client does not belong to the requested organization");
  }

  const { data: row, error } = await supabase
    .from("blitz_runs")
    .insert({
      organization_id: input.organizationId,
      client_id: input.clientId,
      status: "created",
      triggered_by: input.createdBy,
      policy_snapshot: input.policySnapshot
    })
    .select(
      "id,organization_id,client_id,status,started_at,completed_at,triggered_by,created_at,policy_snapshot,summary"
    )
    .single();
  if (error || !row) {
    throw new Error(`Failed to create blitz run: ${error?.message ?? "unknown error"}`);
  }

  return mapRunRow(row as Record<string, unknown>);
}

export async function getRun(runId: string): Promise<BlitzRun | null> {
  if (!isSupabaseConfigured()) {
    return getStore().runs.get(runId) ?? null;
  }

  const supabase = getSupabaseServiceClient();
  const { data: row, error } = await supabase
    .from("blitz_runs")
    .select(
      "id,organization_id,client_id,status,started_at,completed_at,triggered_by,created_at,policy_snapshot,summary"
    )
    .eq("id", runId)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to get run: ${error.message}`);
  }
  if (!row) {
    return null;
  }

  return mapRunRow(row as Record<string, unknown>);
}

export async function listClientRuns(
  clientId: string,
  options?: { limit?: number }
): Promise<BlitzRun[]> {
  const limit = Math.max(1, Math.min(options?.limit ?? 25, 100));

  if (!isSupabaseConfigured()) {
    return [...getStore().runs.values()]
      .filter((run) => run.clientId === clientId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }

  const supabase = getSupabaseServiceClient();
  const { data: rows, error } = await supabase
    .from("blitz_runs")
    .select(
      "id,organization_id,client_id,status,started_at,completed_at,triggered_by,created_at,policy_snapshot,summary"
    )
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    throw new Error(`Failed to list client runs: ${error.message}`);
  }

  return (rows ?? []).map((row) => mapRunRow(row as Record<string, unknown>));
}

export async function listRunActions(runId: string): Promise<BlitzAction[]> {
  if (!isSupabaseConfigured()) {
    return [...getStore().actions.values()].filter((action) => action.runId === runId);
  }

  const supabase = getSupabaseServiceClient();
  const { data: rows, error } = await supabase
    .from("blitz_actions")
    .select(
      "id,run_id,organization_id,client_id,phase,action_type,risk_tier,policy_decision,status,actor,idempotency_key,payload,policy_snapshot,result,error,created_at,executed_at,rolled_back_at"
    )
    .eq("run_id", runId)
    .order("created_at", { ascending: true });
  if (error) {
    throw new Error(`Failed to list run actions: ${error.message}`);
  }

  return (rows ?? []).map((row) => mapActionRow(row as Record<string, unknown>));
}

export async function rollbackAction(
  actionId: string,
  reason: string
): Promise<{
  action: BlitzAction;
  rollback: RollbackRecord;
} | null> {
  if (!isSupabaseConfigured()) {
    const store = getStore();
    const action = store.actions.get(actionId);
    if (!action) {
      return null;
    }

    action.status = "rolled_back";
    action.result = {
      ...(action.result ?? {}),
      rollbackReason: reason,
      rollbackTimestamp: nowIso()
    };
    action.rolledBackAt = nowIso();

    const rollback: RollbackRecord = {
      id: randomUUID(),
      runId: action.runId,
      actionId,
      rolledBackAt: nowIso(),
      reason
    };

    store.rollbacks.set(rollback.id, rollback);
    return { action, rollback };
  }

  const supabase = getSupabaseServiceClient();
  const { data: actionRow, error: actionError } = await supabase
    .from("blitz_actions")
    .select(
      "id,run_id,organization_id,client_id,phase,action_type,risk_tier,policy_decision,status,actor,idempotency_key,payload,policy_snapshot,result,error,created_at,executed_at,rolled_back_at"
    )
    .eq("id", actionId)
    .maybeSingle();
  if (actionError) {
    throw new Error(`Failed to load action for rollback: ${actionError.message}`);
  }
  if (!actionRow) {
    return null;
  }

  const rolledBackAt = nowIso();
  const resultPayload = {
    ...(((actionRow.result as Record<string, unknown> | null) ?? {}) as Record<string, unknown>),
    rollbackReason: reason,
    rollbackTimestamp: rolledBackAt
  };

  const { data: updatedActionRow, error: updateError } = await supabase
    .from("blitz_actions")
    .update({
      status: "rolled_back",
      result: resultPayload,
      rolled_back_at: rolledBackAt
    })
    .eq("id", actionId)
    .select(
      "id,run_id,organization_id,client_id,phase,action_type,risk_tier,policy_decision,status,actor,idempotency_key,payload,policy_snapshot,result,error,created_at,executed_at,rolled_back_at"
    )
    .single();
  if (updateError || !updatedActionRow) {
    throw new Error(`Failed to update action rollback status: ${updateError?.message ?? "unknown error"}`);
  }

  const rollbackId = randomUUID();
  const { error: rollbackError } = await supabase.from("blitz_rollbacks").insert({
    id: rollbackId,
    organization_id: actionRow.organization_id,
    client_id: actionRow.client_id,
    run_id: actionRow.run_id,
    action_id: actionId,
    initiated_by: "operator",
    reason,
    status: "completed",
    completed_at: rolledBackAt
  });
  if (rollbackError) {
    throw new Error(`Failed to create rollback record: ${rollbackError.message}`);
  }

  return {
    action: mapActionRow(updatedActionRow as Record<string, unknown>),
    rollback: {
      id: rollbackId,
      runId: String(actionRow.run_id),
      actionId,
      rolledBackAt,
      reason
    }
  };
}

export async function upsertAutopilotPolicy(
  clientId: string,
  input: Omit<BlitzAutopilotPolicy, "clientId" | "updatedAt">
): Promise<BlitzAutopilotPolicy> {
  if (!isSupabaseConfigured()) {
    const store = getStore();
    const policy: BlitzAutopilotPolicy = {
      clientId,
      ...input,
      updatedAt: nowIso()
    };
    store.autopilotPolicies.set(clientId, policy);
    return policy;
  }

  const supabase = getSupabaseServiceClient();
  const updatedAt = nowIso();
  const { data: row, error } = await supabase
    .from("autopilot_policies")
    .upsert(
      {
        client_id: clientId,
        max_daily_actions_per_location: input.maxDailyActionsPerLocation,
        max_actions_per_phase: input.maxActionsPerPhase,
        min_cooldown_minutes: input.minCooldownMinutes,
        deny_critical_without_escalation: input.denyCriticalWithoutEscalation,
        enabled_action_types: input.enabledActionTypes,
        review_reply_all_ratings_enabled: input.reviewReplyAllRatingsEnabled,
        updated_at: updatedAt
      },
      {
        onConflict: "client_id"
      }
    )
    .select(
      "client_id,max_daily_actions_per_location,max_actions_per_phase,min_cooldown_minutes,deny_critical_without_escalation,enabled_action_types,review_reply_all_ratings_enabled,updated_at"
    )
    .single();
  if (error || !row) {
    throw new Error(`Failed to upsert autopilot policy: ${error?.message ?? "unknown error"}`);
  }

  return {
    clientId: String(row.client_id),
    maxDailyActionsPerLocation: numberValue(row.max_daily_actions_per_location),
    maxActionsPerPhase: numberValue(row.max_actions_per_phase),
    minCooldownMinutes: numberValue(row.min_cooldown_minutes),
    denyCriticalWithoutEscalation: Boolean(row.deny_critical_without_escalation),
    enabledActionTypes: Array.isArray(row.enabled_action_types)
      ? row.enabled_action_types.map((v) => String(v) as BlitzActionType)
      : defaultPolicy(clientId).enabledActionTypes,
    reviewReplyAllRatingsEnabled: Boolean(row.review_reply_all_ratings_enabled),
    updatedAt: String(row.updated_at ?? updatedAt)
  };
}

export async function getAutopilotPolicy(clientId: string): Promise<BlitzAutopilotPolicy> {
  if (!isSupabaseConfigured()) {
    const store = getStore();
    const existing = store.autopilotPolicies.get(clientId);
    if (existing) {
      return existing;
    }
    const seeded = defaultPolicy(clientId);
    store.autopilotPolicies.set(clientId, seeded);
    return seeded;
  }

  const supabase = getSupabaseServiceClient();
  const { data: row, error } = await supabase
    .from("autopilot_policies")
    .select(
      "client_id,max_daily_actions_per_location,max_actions_per_phase,min_cooldown_minutes,deny_critical_without_escalation,enabled_action_types,review_reply_all_ratings_enabled,updated_at"
    )
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to load autopilot policy: ${error.message}`);
  }

  if (!row) {
    return upsertAutopilotPolicy(clientId, {
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
      reviewReplyAllRatingsEnabled: true
    });
  }

  return {
    clientId: String(row.client_id),
    maxDailyActionsPerLocation: numberValue(row.max_daily_actions_per_location),
    maxActionsPerPhase: numberValue(row.max_actions_per_phase),
    minCooldownMinutes: numberValue(row.min_cooldown_minutes),
    denyCriticalWithoutEscalation: Boolean(row.deny_critical_without_escalation),
    enabledActionTypes: Array.isArray(row.enabled_action_types)
      ? row.enabled_action_types.map((v) => String(v) as BlitzActionType)
      : defaultPolicy(clientId).enabledActionTypes,
    reviewReplyAllRatingsEnabled: Boolean(row.review_reply_all_ratings_enabled),
    updatedAt: String(row.updated_at ?? nowIso())
  };
}

export async function connectIntegration(input: {
  organizationId: string;
  clientId: string;
  provider: "gbp" | "ga4" | "google_ads" | "ghl";
  providerAccountId: string;
  scopes: string[];
  encryptedTokenPayload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  tokenExpiresAt?: string | null;
}): Promise<IntegrationConnection> {
  if (!isSupabaseConfigured()) {
    const store = getStore();
    const id = randomUUID();
    const connection: IntegrationConnection = {
      id,
      organizationId: input.organizationId,
      clientId: input.clientId,
      provider: input.provider,
      providerAccountId: input.providerAccountId,
      scopes: input.scopes,
      encryptedTokenPayload: input.encryptedTokenPayload,
      metadata: input.metadata ?? {},
      tokenExpiresAt: input.tokenExpiresAt ?? null,
      connectedAt: nowIso(),
      lastRefreshAt: null,
      isActive: true,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    store.integrations.set(id, connection);
    return connection;
  }

  const supabase = getSupabaseServiceClient();
  const { data: clientRow, error: clientError } = await supabase
    .from("clients")
    .select("organization_id")
    .eq("id", input.clientId)
    .maybeSingle();
  if (clientError || !clientRow) {
    throw new Error(`Failed to load client before integration connect: ${clientError?.message ?? "client not found"}`);
  }
  if (String(clientRow.organization_id) !== input.organizationId) {
    throw new Error("Client does not belong to the requested organization");
  }

  const { data: row, error } = await supabase
    .from("integration_connections")
    .upsert(
      {
        organization_id: input.organizationId,
        client_id: input.clientId,
        provider: input.provider,
        provider_account_id: input.providerAccountId,
        encrypted_token_payload: input.encryptedTokenPayload,
        scopes: input.scopes,
        metadata: input.metadata ?? {},
        token_expires_at: input.tokenExpiresAt ?? null,
        is_active: true
      },
      {
        onConflict: "client_id,provider,provider_account_id"
      }
    )
    .select(
      "id,organization_id,client_id,provider,provider_account_id,scopes,encrypted_token_payload,metadata,token_expires_at,connected_at,last_refresh_at,is_active,created_at,updated_at"
    )
    .single();
  if (error || !row) {
    throw new Error(`Failed to connect integration: ${error?.message ?? "unknown error"}`);
  }

  return mapIntegrationRow(row as Record<string, unknown>);
}

export async function setRunStatus(runId: string, status: BlitzRunStatus): Promise<BlitzRun | null> {
  if (!isSupabaseConfigured()) {
    const store = getStore();
    const run = store.runs.get(runId);
    if (!run) {
      return null;
    }

    run.status = status;
    if (status === "running" && !run.startedAt) {
      run.startedAt = nowIso();
    }

    if (status === "completed" || status === "failed" || status === "partially_completed" || status === "rolled_back") {
      run.completedAt = nowIso();
    }

    return run;
  }

  const supabase = getSupabaseServiceClient();
  const patch: Record<string, unknown> = { status };
  if (status === "running") {
    patch.started_at = nowIso();
  }
  if (status === "completed" || status === "failed" || status === "partially_completed" || status === "rolled_back") {
    patch.completed_at = nowIso();
  }

  const { data: row, error } = await supabase
    .from("blitz_runs")
    .update(patch)
    .eq("id", runId)
    .select(
      "id,organization_id,client_id,status,started_at,completed_at,triggered_by,created_at,policy_snapshot,summary"
    )
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to set run status: ${error.message}`);
  }
  if (!row) {
    return null;
  }

  return mapRunRow(row as Record<string, unknown>);
}

export async function addAttributionRecord(record: DailyChannelMetric): Promise<void> {
  if (!isSupabaseConfigured()) {
    getStore().attribution.push(record);
    return;
  }

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("attribution_daily").insert({
    organization_id: record.organizationId,
    client_id: record.clientId,
    location_id: record.locationId,
    date: record.date,
    channel: record.channel,
    impressions: record.impressions,
    clicks: record.clicks,
    calls: record.calls,
    directions: record.directions,
    conversions: record.conversions,
    spend: record.spend,
    conversion_value: record.conversionValue,
    source_payload: record.sourcePayload
  });
  if (error) {
    throw new Error(`Failed to add attribution record: ${error.message}`);
  }
}

export async function getAttributionWindow(
  clientId: string,
  window: "7d" | "30d" | "90d"
): Promise<{
  daily: BlendedDailyMetric[];
  summary: BlitzImpactSummary;
}> {
  let filtered: DailyChannelMetric[] = [];

  if (!isSupabaseConfigured()) {
    const store = getStore();
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - daysForWindow(window));
    filtered = store.attribution.filter((row) => {
      return row.clientId === clientId && new Date(`${row.date}T00:00:00.000Z`) >= since;
    });
  } else {
    const supabase = getSupabaseServiceClient();
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - daysForWindow(window));
    const sinceDate = since.toISOString().slice(0, 10);
    const { data: rows, error } = await supabase
      .from("attribution_daily")
      .select(
        "organization_id,client_id,location_id,date,channel,impressions,clicks,calls,directions,conversions,spend,conversion_value,source_payload"
      )
      .eq("client_id", clientId)
      .gte("date", sinceDate)
      .order("date", { ascending: true });
    if (error) {
      throw new Error(`Failed to read attribution: ${error.message}`);
    }

    filtered = (rows ?? []).map((row) => ({
      organizationId: String(row.organization_id),
      clientId: String(row.client_id),
      locationId: row.location_id ? String(row.location_id) : null,
      date: String(row.date),
      channel: String(row.channel) as DailyChannelMetric["channel"],
      impressions: numberValue(row.impressions),
      clicks: numberValue(row.clicks),
      calls: numberValue(row.calls),
      directions: numberValue(row.directions),
      conversions: numberValue(row.conversions),
      spend: numberValue(row.spend),
      conversionValue: numberValue(row.conversion_value),
      sourcePayload: (row.source_payload as Record<string, unknown> | null) ?? {}
    }));
  }

  const daily = normalizeDailyMetrics(filtered);

  const totals = daily.reduce(
    (acc, row) => {
      acc.conversions += row.conversions;
      acc.spend += row.spend;
      return acc;
    },
    { conversions: 0, spend: 0 }
  );

  const baselineConversions = Math.max(0, totals.conversions * 0.8);
  const baselineSpend = Math.max(0, totals.spend * 0.9);
  const blendedCostPerResult = totals.conversions > 0 ? totals.spend / totals.conversions : 0;

  const summary: BlitzImpactSummary = {
    organizationId: daily[0]?.organizationId ?? "unknown-org",
    clientId,
    locationId: daily[0]?.locationId ?? null,
    window,
    baselineConversions,
    currentConversions: totals.conversions,
    baselineSpend,
    currentSpend: totals.spend,
    blendedCostPerResult,
    directionalLiftPct:
      baselineConversions > 0 ? ((totals.conversions - baselineConversions) / baselineConversions) * 100 : 0
  };

  return { daily, summary };
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function policyDecisionForRisk(
  riskTier: RiskTier,
  denyCriticalWithoutEscalation: boolean
): PolicyDecision {
  if (riskTier === "critical" && denyCriticalWithoutEscalation) {
    return "allow_with_escalation";
  }
  if (riskTier === "high") {
    return "allow_with_limit";
  }
  return "allow";
}
