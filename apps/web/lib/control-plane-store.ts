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

export interface ClientOrchestrationSettings {
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

export interface ClientMediaAsset {
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

export interface ClientActionNeeded {
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
  orchestrationSettings: Map<string, ClientOrchestrationSettings>;
  mediaAssets: Map<string, ClientMediaAsset>;
  actionsNeeded: Map<string, ClientActionNeeded>;
  integrations: Map<string, IntegrationConnection>;
  rollbacks: Map<string, RollbackRecord>;
  contentArtifacts: Map<string, ContentArtifact>;
  attribution: DailyChannelMetric[];
}

export interface ContentArtifact {
  id: string;
  organizationId: string;
  clientId: string;
  runId: string | null;
  phase: BlitzPhase;
  channel: string;
  title: string | null;
  body: string;
  metadata: Record<string, unknown>;
  status: "draft" | "scheduled" | "published" | "failed";
  scheduledFor: string | null;
  publishedAt: string | null;
  createdAt: string;
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
      orchestrationSettings: new Map(),
      mediaAssets: new Map(),
      actionsNeeded: new Map(),
      integrations: new Map(),
      rollbacks: new Map(),
      contentArtifacts: new Map(),
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

function defaultOrchestrationSettings(
  clientId: string,
  organizationId = "demo-org"
): ClientOrchestrationSettings {
  return {
    clientId,
    organizationId,
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

function mapOrchestrationSettingsRow(row: Record<string, unknown>): ClientOrchestrationSettings {
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

function mapClientMediaAssetRow(row: Record<string, unknown>): ClientMediaAsset {
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

function mapClientActionNeededRow(row: Record<string, unknown>): ClientActionNeeded {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    clientId: String(row.client_id),
    runId: typeof row.run_id === "string" ? row.run_id : null,
    sourceActionId: typeof row.source_action_id === "string" ? row.source_action_id : null,
    provider: String(row.provider) as ClientActionNeeded["provider"],
    locationName: typeof row.location_name === "string" ? row.location_name : null,
    locationId: typeof row.location_id === "string" ? row.location_id : null,
    actionType: String(row.action_type) as ClientActionNeeded["actionType"],
    riskTier: String(row.risk_tier) as ClientActionNeeded["riskTier"],
    title: String(row.title),
    description: typeof row.description === "string" ? row.description : null,
    status: String(row.status) as ClientActionNeeded["status"],
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

function mapContentArtifactRow(row: Record<string, unknown>): ContentArtifact {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    clientId: String(row.client_id),
    runId: typeof row.run_id === "string" ? row.run_id : null,
    phase: String(row.phase) as BlitzPhase,
    channel: typeof row.channel === "string" ? row.channel : "gbp",
    title: typeof row.title === "string" ? row.title : null,
    body: String(row.body ?? ""),
    metadata: (row.metadata as Record<string, unknown> | null) ?? {},
    status: String(row.status) as ContentArtifact["status"],
    scheduledFor: toIsoOrNull(row.scheduled_for),
    publishedAt: toIsoOrNull(row.published_at),
    createdAt: String(row.created_at ?? nowIso())
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
    store.orchestrationSettings.set(id, defaultOrchestrationSettings(id, input.organizationId));
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
  await getClientOrchestrationSettings(String(row.id));
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

export async function getClientById(clientId: string): Promise<Client | null> {
  if (!isSupabaseConfigured()) {
    return getStore().clients.get(clientId) ?? null;
  }

  const supabase = getSupabaseServiceClient();
  const { data: row, error } = await supabase
    .from("clients")
    .select("id,organization_id,name,timezone,website_url,primary_location_label,created_at")
    .eq("id", clientId)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to load client: ${error.message}`);
  }

  if (!row) {
    return null;
  }

  return mapClientRow(row as Record<string, unknown>);
}

export async function deleteClientById(
  clientId: string,
  organizationId: string
): Promise<{ deleted: boolean }> {
  if (!isSupabaseConfigured()) {
    const store = getStore();
    const client = store.clients.get(clientId);
    if (!client || client.organizationId !== organizationId) {
      return { deleted: false };
    }

    store.clients.delete(clientId);
    store.autopilotPolicies.delete(clientId);
    store.orchestrationSettings.delete(clientId);
    for (const [assetId, asset] of store.mediaAssets.entries()) {
      if (asset.clientId === clientId) {
        store.mediaAssets.delete(assetId);
      }
    }
    for (const [integrationId, integration] of store.integrations.entries()) {
      if (integration.clientId === clientId) {
        store.integrations.delete(integrationId);
      }
    }
    for (const [taskId, task] of store.actionsNeeded.entries()) {
      if (task.clientId === clientId) {
        store.actionsNeeded.delete(taskId);
      }
    }
    for (const [runId, run] of store.runs.entries()) {
      if (run.clientId === clientId) {
        store.runs.delete(runId);
      }
    }
    for (const [actionId, action] of store.actions.entries()) {
      if (action.clientId === clientId) {
        store.actions.delete(actionId);
      }
    }
    return { deleted: true };
  }

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("clients")
    .delete()
    .eq("id", clientId)
    .eq("organization_id", organizationId);
  if (error) {
    throw new Error(`Failed to delete client: ${error.message}`);
  }

  return { deleted: true };
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
  const { data: clientRow, error: clientError } = await supabase
    .from("clients")
    .select("organization_id")
    .eq("id", clientId)
    .maybeSingle();
  if (clientError || !clientRow) {
    throw new Error(
      `Failed to resolve client organization for autopilot policy upsert ${clientId}: ${clientError?.message ?? "client not found"}`
    );
  }

  const updatedAt = nowIso();
  const { data: row, error } = await supabase
    .from("autopilot_policies")
    .upsert(
      {
        organization_id: String(clientRow.organization_id),
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
  provider: "gbp" | "ga4" | "google_ads" | "search_console" | "ghl";
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

export async function listClientIntegrations(clientId: string): Promise<IntegrationConnection[]> {
  if (!isSupabaseConfigured()) {
    return [...getStore().integrations.values()].filter((connection) => connection.clientId === clientId);
  }

  const supabase = getSupabaseServiceClient();
  const { data: rows, error } = await supabase
    .from("integration_connections")
    .select(
      "id,organization_id,client_id,provider,provider_account_id,scopes,encrypted_token_payload,metadata,token_expires_at,connected_at,last_refresh_at,is_active,created_at,updated_at"
    )
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  if (error) {
    throw new Error(`Failed to list client integrations: ${error.message}`);
  }

  return (rows ?? []).map((row) => mapIntegrationRow(row as Record<string, unknown>));
}

export async function updateIntegrationConnection(
  connectionId: string,
  patch: {
    providerAccountId?: string;
    scopes?: string[];
    encryptedTokenPayload?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    tokenExpiresAt?: string | null;
    lastRefreshAt?: string | null;
    isActive?: boolean;
  }
): Promise<IntegrationConnection | null> {
  if (!isSupabaseConfigured()) {
    const store = getStore();
    const current = store.integrations.get(connectionId);
    if (!current) {
      return null;
    }
    const next: IntegrationConnection = {
      ...current,
      providerAccountId: patch.providerAccountId ?? current.providerAccountId,
      scopes: patch.scopes ?? current.scopes,
      encryptedTokenPayload: patch.encryptedTokenPayload ?? current.encryptedTokenPayload,
      metadata: patch.metadata ?? current.metadata,
      tokenExpiresAt: patch.tokenExpiresAt ?? current.tokenExpiresAt,
      lastRefreshAt: patch.lastRefreshAt ?? current.lastRefreshAt,
      isActive: patch.isActive ?? current.isActive,
      updatedAt: nowIso()
    };
    store.integrations.set(connectionId, next);
    return next;
  }

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

  const { data, error } = await getSupabaseServiceClient()
    .from("integration_connections")
    .update(updatePatch)
    .eq("id", connectionId)
    .select(
      "id,organization_id,client_id,provider,provider_account_id,scopes,encrypted_token_payload,metadata,token_expires_at,connected_at,last_refresh_at,is_active,created_at,updated_at"
    )
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to update integration connection: ${error.message}`);
  }

  return data ? mapIntegrationRow(data as Record<string, unknown>) : null;
}

export async function listClientContentArtifacts(
  clientId: string,
  options?: {
    channel?: string;
    phase?: BlitzPhase;
    status?: ContentArtifact["status"] | "all";
    limit?: number;
  }
): Promise<ContentArtifact[]> {
  const limit = Math.max(1, Math.min(options?.limit ?? 100, 500));

  if (!isSupabaseConfigured()) {
    let rows = [...getStore().contentArtifacts.values()].filter((artifact) => artifact.clientId === clientId);
    if (options?.channel) {
      rows = rows.filter((artifact) => artifact.channel === options.channel);
    }
    if (options?.phase) {
      rows = rows.filter((artifact) => artifact.phase === options.phase);
    }
    if (options?.status && options.status !== "all") {
      rows = rows.filter((artifact) => artifact.status === options.status);
    }
    return rows
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }

  let query = getSupabaseServiceClient()
    .from("content_artifacts")
    .select("id,organization_id,client_id,run_id,phase,channel,title,body,metadata,status,scheduled_for,published_at,created_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (options?.channel) {
    query = query.eq("channel", options.channel);
  }
  if (options?.phase) {
    query = query.eq("phase", options.phase);
  }
  if (options?.status && options.status !== "all") {
    query = query.eq("status", options.status);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to list content artifacts: ${error.message}`);
  }
  return (data ?? []).map((row) => mapContentArtifactRow(row as Record<string, unknown>));
}

export async function createContentArtifact(input: {
  organizationId: string;
  clientId: string;
  runId?: string | null;
  phase: BlitzPhase;
  channel: string;
  title?: string | null;
  body: string;
  metadata?: Record<string, unknown>;
  status?: ContentArtifact["status"];
  scheduledFor?: string | null;
  publishedAt?: string | null;
}): Promise<ContentArtifact> {
  if (!isSupabaseConfigured()) {
    const store = getStore();
    const artifact: ContentArtifact = {
      id: randomUUID(),
      organizationId: input.organizationId,
      clientId: input.clientId,
      runId: input.runId ?? null,
      phase: input.phase,
      channel: input.channel,
      title: input.title ?? null,
      body: input.body,
      metadata: input.metadata ?? {},
      status: input.status ?? "draft",
      scheduledFor: input.scheduledFor ?? null,
      publishedAt: input.publishedAt ?? null,
      createdAt: nowIso()
    };
    store.contentArtifacts.set(artifact.id, artifact);
    return artifact;
  }

  const { data, error } = await getSupabaseServiceClient()
    .from("content_artifacts")
    .insert({
      organization_id: input.organizationId,
      client_id: input.clientId,
      run_id: input.runId ?? null,
      phase: input.phase,
      channel: input.channel,
      title: input.title ?? null,
      body: input.body,
      metadata: input.metadata ?? {},
      status: input.status ?? "draft",
      scheduled_for: input.scheduledFor ?? null,
      published_at: input.publishedAt ?? null
    })
    .select("id,organization_id,client_id,run_id,phase,channel,title,body,metadata,status,scheduled_for,published_at,created_at")
    .single();
  if (error || !data) {
    throw new Error(`Failed to create content artifact: ${error?.message ?? "unknown error"}`);
  }
  return mapContentArtifactRow(data as Record<string, unknown>);
}

export async function updateContentArtifact(
  artifactId: string,
  patch: {
    title?: string | null;
    body?: string;
    status?: ContentArtifact["status"];
    metadata?: Record<string, unknown>;
    scheduledFor?: string | null;
    publishedAt?: string | null;
  }
): Promise<ContentArtifact | null> {
  if (!isSupabaseConfigured()) {
    const store = getStore();
    const current = store.contentArtifacts.get(artifactId);
    if (!current) {
      return null;
    }
    const next: ContentArtifact = {
      ...current,
      title: patch.title ?? current.title,
      body: patch.body ?? current.body,
      status: patch.status ?? current.status,
      metadata: patch.metadata ?? current.metadata,
      scheduledFor: patch.scheduledFor ?? current.scheduledFor,
      publishedAt: patch.publishedAt ?? current.publishedAt
    };
    store.contentArtifacts.set(artifactId, next);
    return next;
  }

  const updatePatch: Record<string, unknown> = {};
  if (patch.title !== undefined) {
    updatePatch.title = patch.title;
  }
  if (patch.body !== undefined) {
    updatePatch.body = patch.body;
  }
  if (patch.status !== undefined) {
    updatePatch.status = patch.status;
  }
  if (patch.metadata !== undefined) {
    updatePatch.metadata = patch.metadata;
  }
  if (patch.scheduledFor !== undefined) {
    updatePatch.scheduled_for = patch.scheduledFor;
  }
  if (patch.publishedAt !== undefined) {
    updatePatch.published_at = patch.publishedAt;
  }

  const { data, error } = await getSupabaseServiceClient()
    .from("content_artifacts")
    .update(updatePatch)
    .eq("id", artifactId)
    .select("id,organization_id,client_id,run_id,phase,channel,title,body,metadata,status,scheduled_for,published_at,created_at")
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to update content artifact: ${error.message}`);
  }
  return data ? mapContentArtifactRow(data as Record<string, unknown>) : null;
}

export async function createClientMediaAsset(input: {
  organizationId: string;
  clientId: string;
  storageBucket: string;
  storagePath: string;
  fileName: string;
  mimeType?: string | null;
  bytes?: number | null;
  isAllowedForPosts?: boolean;
  tags?: string[];
  metadata?: Record<string, unknown>;
}): Promise<ClientMediaAsset> {
  if (!isSupabaseConfigured()) {
    const store = getStore();
    const id = randomUUID();
    const asset: ClientMediaAsset = {
      id,
      organizationId: input.organizationId,
      clientId: input.clientId,
      storageBucket: input.storageBucket,
      storagePath: input.storagePath,
      fileName: input.fileName,
      mimeType: input.mimeType ?? null,
      bytes: input.bytes ?? null,
      isAllowedForPosts: input.isAllowedForPosts !== false,
      tags: input.tags ?? [],
      metadata: input.metadata ?? {},
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    store.mediaAssets.set(id, asset);
    return asset;
  }

  const supabase = getSupabaseServiceClient();
  const { data: row, error } = await supabase
    .from("client_media_assets")
    .insert({
      organization_id: input.organizationId,
      client_id: input.clientId,
      storage_bucket: input.storageBucket,
      storage_path: input.storagePath,
      file_name: input.fileName,
      mime_type: input.mimeType ?? null,
      bytes: input.bytes ?? null,
      is_allowed_for_posts: input.isAllowedForPosts !== false,
      tags: input.tags ?? [],
      metadata: input.metadata ?? {}
    })
    .select(
      "id,organization_id,client_id,storage_bucket,storage_path,file_name,mime_type,bytes,is_allowed_for_posts,tags,metadata,created_at,updated_at"
    )
    .single();
  if (error || !row) {
    throw new Error(`Failed to create client media asset: ${error?.message ?? "unknown error"}`);
  }

  return mapClientMediaAssetRow(row as Record<string, unknown>);
}

export async function listClientMediaAssets(clientId: string): Promise<ClientMediaAsset[]> {
  if (!isSupabaseConfigured()) {
    return [...getStore().mediaAssets.values()]
      .filter((asset) => asset.clientId === clientId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  const supabase = getSupabaseServiceClient();
  const { data: rows, error } = await supabase
    .from("client_media_assets")
    .select(
      "id,organization_id,client_id,storage_bucket,storage_path,file_name,mime_type,bytes,is_allowed_for_posts,tags,metadata,created_at,updated_at"
    )
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  if (error) {
    throw new Error(`Failed to list client media assets: ${error.message}`);
  }

  return (rows ?? []).map((row) => mapClientMediaAssetRow(row as Record<string, unknown>));
}

export async function getClientMediaAssetById(assetId: string): Promise<ClientMediaAsset | null> {
  if (!isSupabaseConfigured()) {
    return getStore().mediaAssets.get(assetId) ?? null;
  }

  const supabase = getSupabaseServiceClient();
  const { data: row, error } = await supabase
    .from("client_media_assets")
    .select(
      "id,organization_id,client_id,storage_bucket,storage_path,file_name,mime_type,bytes,is_allowed_for_posts,tags,metadata,created_at,updated_at"
    )
    .eq("id", assetId)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to load client media asset: ${error.message}`);
  }

  return row ? mapClientMediaAssetRow(row as Record<string, unknown>) : null;
}

export async function updateClientMediaAsset(
  assetId: string,
  input: {
    isAllowedForPosts?: boolean;
    tags?: string[];
    metadata?: Record<string, unknown>;
  }
): Promise<ClientMediaAsset | null> {
  if (!isSupabaseConfigured()) {
    const store = getStore();
    const existing = store.mediaAssets.get(assetId);
    if (!existing) {
      return null;
    }

    const next: ClientMediaAsset = {
      ...existing,
      isAllowedForPosts: input.isAllowedForPosts ?? existing.isAllowedForPosts,
      tags: input.tags ?? existing.tags,
      metadata: input.metadata ?? existing.metadata,
      updatedAt: nowIso()
    };
    store.mediaAssets.set(assetId, next);
    return next;
  }

  const patch: Record<string, unknown> = {};
  if (input.isAllowedForPosts !== undefined) {
    patch.is_allowed_for_posts = input.isAllowedForPosts;
  }
  if (input.tags !== undefined) {
    patch.tags = input.tags;
  }
  if (input.metadata !== undefined) {
    patch.metadata = input.metadata;
  }

  const supabase = getSupabaseServiceClient();
  const { data: row, error } = await supabase
    .from("client_media_assets")
    .update(patch)
    .eq("id", assetId)
    .select(
      "id,organization_id,client_id,storage_bucket,storage_path,file_name,mime_type,bytes,is_allowed_for_posts,tags,metadata,created_at,updated_at"
    )
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to update client media asset: ${error.message}`);
  }

  return row ? mapClientMediaAssetRow(row as Record<string, unknown>) : null;
}

export async function deleteClientMediaAsset(assetId: string): Promise<{ deleted: boolean }> {
  if (!isSupabaseConfigured()) {
    const store = getStore();
    const deleted = store.mediaAssets.delete(assetId);
    return { deleted };
  }

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("client_media_assets").delete().eq("id", assetId);
  if (error) {
    throw new Error(`Failed to delete client media asset: ${error.message}`);
  }
  return { deleted: true };
}

export async function listClientActionsNeeded(
  clientId: string,
  options?: { status?: ClientActionNeeded["status"] | "all"; limit?: number }
): Promise<ClientActionNeeded[]> {
  const limit = Math.max(1, Math.min(options?.limit ?? 100, 500));

  if (!isSupabaseConfigured()) {
    const store = getStore();
    const rows = [...store.actionsNeeded.values()].filter((item) => item.clientId === clientId);
    const filtered =
      options?.status && options.status !== "all"
        ? rows.filter((item) => item.status === options.status)
        : rows;
    return filtered
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }

  const supabase = getSupabaseServiceClient();
  let query = supabase
    .from("client_actions_needed")
    .select(
      "id,organization_id,client_id,run_id,source_action_id,provider,location_name,location_id,action_type,risk_tier,title,description,status,fingerprint,payload,result,approved_by,approved_at,executed_at,created_at,updated_at"
    )
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (options?.status && options.status !== "all") {
    query = query.eq("status", options.status);
  }

  const { data: rows, error } = await query;
  if (error) {
    throw new Error(`Failed to list client actions-needed queue: ${error.message}`);
  }
  return (rows ?? []).map((row) => mapClientActionNeededRow(row as Record<string, unknown>));
}

export async function getClientActionNeededById(actionNeededId: string): Promise<ClientActionNeeded | null> {
  if (!isSupabaseConfigured()) {
    return getStore().actionsNeeded.get(actionNeededId) ?? null;
  }

  const supabase = getSupabaseServiceClient();
  const { data: row, error } = await supabase
    .from("client_actions_needed")
    .select(
      "id,organization_id,client_id,run_id,source_action_id,provider,location_name,location_id,action_type,risk_tier,title,description,status,fingerprint,payload,result,approved_by,approved_at,executed_at,created_at,updated_at"
    )
    .eq("id", actionNeededId)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to load actions-needed item: ${error.message}`);
  }

  return row ? mapClientActionNeededRow(row as Record<string, unknown>) : null;
}

export async function updateClientActionNeeded(
  actionNeededId: string,
  patch: {
    status?: ClientActionNeeded["status"];
    result?: Record<string, unknown>;
    approvedBy?: string | null;
    approvedAt?: string | null;
    executedAt?: string | null;
  }
): Promise<ClientActionNeeded | null> {
  if (!isSupabaseConfigured()) {
    const store = getStore();
    const current = store.actionsNeeded.get(actionNeededId);
    if (!current) {
      return null;
    }
    const next: ClientActionNeeded = {
      ...current,
      status: patch.status ?? current.status,
      result: patch.result ?? current.result,
      approvedBy: patch.approvedBy ?? current.approvedBy,
      approvedAt: patch.approvedAt ?? current.approvedAt,
      executedAt: patch.executedAt ?? current.executedAt,
      updatedAt: nowIso()
    };
    store.actionsNeeded.set(actionNeededId, next);
    return next;
  }

  const updatePatch: Record<string, unknown> = {};
  if (patch.status !== undefined) {
    updatePatch.status = patch.status;
  }
  if (patch.result !== undefined) {
    updatePatch.result = patch.result;
  }
  if (patch.approvedBy !== undefined) {
    updatePatch.approved_by = patch.approvedBy;
  }
  if (patch.approvedAt !== undefined) {
    updatePatch.approved_at = patch.approvedAt;
  }
  if (patch.executedAt !== undefined) {
    updatePatch.executed_at = patch.executedAt;
  }

  const supabase = getSupabaseServiceClient();
  const { data: row, error } = await supabase
    .from("client_actions_needed")
    .update(updatePatch)
    .eq("id", actionNeededId)
    .select(
      "id,organization_id,client_id,run_id,source_action_id,provider,location_name,location_id,action_type,risk_tier,title,description,status,fingerprint,payload,result,approved_by,approved_at,executed_at,created_at,updated_at"
    )
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to update actions-needed item: ${error.message}`);
  }

  return row ? mapClientActionNeededRow(row as Record<string, unknown>) : null;
}

export async function upsertClientOrchestrationSettings(
  clientId: string,
  input: Omit<
    ClientOrchestrationSettings,
    "clientId" | "organizationId" | "createdAt" | "updatedAt"
  >
): Promise<ClientOrchestrationSettings> {
  if (!isSupabaseConfigured()) {
    const store = getStore();
    const existing = store.orchestrationSettings.get(clientId);
    const seeded = existing ?? defaultOrchestrationSettings(clientId);
    const next: ClientOrchestrationSettings = {
      ...seeded,
      ...input,
      updatedAt: nowIso()
    };
    store.orchestrationSettings.set(clientId, next);
    return next;
  }

  const supabase = getSupabaseServiceClient();
  const { data: clientRow, error: clientError } = await supabase
    .from("clients")
    .select("organization_id")
    .eq("id", clientId)
    .maybeSingle();
  if (clientError || !clientRow) {
    throw new Error(
      `Failed to resolve client organization for orchestration settings ${clientId}: ${clientError?.message ?? "client not found"}`
    );
  }

  const { data: row, error } = await supabase
    .from("client_orchestration_settings")
    .upsert(
      {
        organization_id: String(clientRow.organization_id),
        client_id: clientId,
        tone: input.tone,
        objectives: input.objectives,
        photo_asset_urls: input.photoAssetUrls,
        photo_asset_ids: input.photoAssetIds,
        sitemap_url: input.sitemapUrl,
        default_post_url: input.defaultPostUrl,
        review_reply_style: input.reviewReplyStyle,
        post_frequency_per_week: input.postFrequencyPerWeek,
        post_word_count_min: input.postWordCountMin,
        post_word_count_max: input.postWordCountMax,
        eeat_structured_snippet_enabled: input.eeatStructuredSnippetEnabled,
        metadata: input.metadata
      },
      {
        onConflict: "client_id"
      }
    )
    .select(
      "organization_id,client_id,tone,objectives,photo_asset_urls,photo_asset_ids,sitemap_url,default_post_url,review_reply_style,post_frequency_per_week,post_word_count_min,post_word_count_max,eeat_structured_snippet_enabled,metadata,created_at,updated_at"
    )
    .single();
  if (error || !row) {
    throw new Error(`Failed to upsert orchestration settings: ${error?.message ?? "unknown error"}`);
  }

  return mapOrchestrationSettingsRow(row as Record<string, unknown>);
}

export async function getClientOrchestrationSettings(clientId: string): Promise<ClientOrchestrationSettings> {
  if (!isSupabaseConfigured()) {
    const store = getStore();
    const existing = store.orchestrationSettings.get(clientId);
    if (existing) {
      return existing;
    }
    const seeded = defaultOrchestrationSettings(clientId);
    store.orchestrationSettings.set(clientId, seeded);
    return seeded;
  }

  const supabase = getSupabaseServiceClient();
  const { data: clientRow, error: clientError } = await supabase
    .from("clients")
    .select("organization_id")
    .eq("id", clientId)
    .maybeSingle();
  if (clientError || !clientRow) {
    throw new Error(
      `Failed to resolve client organization for orchestration settings ${clientId}: ${clientError?.message ?? "client not found"}`
    );
  }

  const { data: row, error } = await supabase
    .from("client_orchestration_settings")
    .select(
      "organization_id,client_id,tone,objectives,photo_asset_urls,photo_asset_ids,sitemap_url,default_post_url,review_reply_style,post_frequency_per_week,post_word_count_min,post_word_count_max,eeat_structured_snippet_enabled,metadata,created_at,updated_at"
    )
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to read orchestration settings: ${error.message}`);
  }

  if (!row) {
    return upsertClientOrchestrationSettings(clientId, {
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
      metadata: {}
    });
  }

  return mapOrchestrationSettingsRow(row as Record<string, unknown>);
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

export async function replaceAttributionRange(input: {
  clientId: string;
  organizationId: string;
  dateFrom: string;
  dateTo: string;
  channels: DailyChannelMetric["channel"][];
  rows: DailyChannelMetric[];
}): Promise<void> {
  if (!isSupabaseConfigured()) {
    const store = getStore();
    const channelSet = new Set(input.channels);
    store.attribution = store.attribution.filter((row) => {
      return !(
        row.clientId === input.clientId &&
        channelSet.has(row.channel) &&
        row.date >= input.dateFrom &&
        row.date <= input.dateTo
      );
    });
    store.attribution.push(...input.rows);
    return;
  }

  const supabase = getSupabaseServiceClient();
  const { error: deleteError } = await supabase
    .from("attribution_daily")
    .delete()
    .eq("client_id", input.clientId)
    .gte("date", input.dateFrom)
    .lte("date", input.dateTo)
    .in("channel", input.channels);
  if (deleteError) {
    throw new Error(`Failed to clear attribution range: ${deleteError.message}`);
  }

  if (!input.rows.length) {
    return;
  }

  const payload = input.rows.map((record) => ({
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
  }));
  const { error: insertError } = await supabase.from("attribution_daily").insert(payload);
  if (insertError) {
    throw new Error(`Failed to write attribution range: ${insertError.message}`);
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
