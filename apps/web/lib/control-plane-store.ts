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

interface Organization {
  id: string;
  name: string;
  slug: string;
  ownerEmail: string;
  createdAt: string;
}

interface Client {
  id: string;
  organizationId: string;
  name: string;
  timezone: string;
  websiteUrl: string | null;
  primaryLocationLabel: string | null;
  createdAt: string;
}

interface IntegrationConnection {
  id: string;
  organizationId: string;
  clientId: string;
  provider: "gbp" | "ga4" | "google_ads" | "ghl";
  providerAccountId: string;
  scopes: string[];
  encryptedTokenPayload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface RollbackRecord {
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
    updatedAt: new Date().toISOString()
  };
}

export function createOrganization(input: {
  name: string;
  slug: string;
  ownerEmail: string;
}): Organization {
  const store = getStore();
  const id = randomUUID();
  const org: Organization = {
    id,
    name: input.name,
    slug: input.slug,
    ownerEmail: input.ownerEmail,
    createdAt: new Date().toISOString()
  };
  store.organizations.set(id, org);
  return org;
}

export function createClient(input: {
  organizationId: string;
  name: string;
  timezone: string;
  websiteUrl?: string;
  primaryLocationLabel?: string;
}): Client {
  const store = getStore();
  const id = randomUUID();
  const client: Client = {
    id,
    organizationId: input.organizationId,
    name: input.name,
    timezone: input.timezone,
    websiteUrl: input.websiteUrl ?? null,
    primaryLocationLabel: input.primaryLocationLabel ?? null,
    createdAt: new Date().toISOString()
  };
  store.clients.set(id, client);
  store.autopilotPolicies.set(id, defaultPolicy(id));
  return client;
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
      createdAt: new Date().toISOString(),
      executedAt: null
    };

    store.actions.set(action.id, action);
    return action;
  });

  return actions;
}

export function createBlitzRun(input: {
  organizationId: string;
  clientId: string;
  createdBy: string;
  policySnapshot: Record<string, unknown>;
}): BlitzRun {
  const store = getStore();
  const run: BlitzRun = {
    id: randomUUID(),
    organizationId: input.organizationId,
    clientId: input.clientId,
    status: "created",
    startedAt: null,
    completedAt: null,
    createdBy: input.createdBy,
    createdAt: new Date().toISOString(),
    policySnapshot: input.policySnapshot,
    summary: null
  };

  store.runs.set(run.id, run);
  seedRunActions(run.id);
  return run;
}

export function getRun(runId: string): BlitzRun | null {
  return getStore().runs.get(runId) ?? null;
}

export function listRunActions(runId: string): BlitzAction[] {
  return [...getStore().actions.values()].filter((action) => action.runId === runId);
}

export function rollbackAction(actionId: string, reason: string): {
  action: BlitzAction;
  rollback: RollbackRecord;
} | null {
  const store = getStore();
  const action = store.actions.get(actionId);
  if (!action) {
    return null;
  }

  action.status = "rolled_back";
  action.result = {
    ...(action.result ?? {}),
    rollbackReason: reason,
    rollbackTimestamp: new Date().toISOString()
  };

  const rollback: RollbackRecord = {
    id: randomUUID(),
    runId: action.runId,
    actionId,
    rolledBackAt: new Date().toISOString(),
    reason
  };

  store.rollbacks.set(rollback.id, rollback);
  return { action, rollback };
}

export function upsertAutopilotPolicy(
  clientId: string,
  input: Omit<BlitzAutopilotPolicy, "clientId" | "updatedAt">
): BlitzAutopilotPolicy {
  const store = getStore();
  const policy: BlitzAutopilotPolicy = {
    clientId,
    ...input,
    updatedAt: new Date().toISOString()
  };
  store.autopilotPolicies.set(clientId, policy);
  return policy;
}

export function getAutopilotPolicy(clientId: string): BlitzAutopilotPolicy {
  const store = getStore();
  const existing = store.autopilotPolicies.get(clientId);
  if (existing) {
    return existing;
  }
  const seeded = defaultPolicy(clientId);
  store.autopilotPolicies.set(clientId, seeded);
  return seeded;
}

export function connectIntegration(input: {
  organizationId: string;
  clientId: string;
  provider: "gbp" | "ga4" | "google_ads" | "ghl";
  providerAccountId: string;
  scopes: string[];
  encryptedTokenPayload: Record<string, unknown>;
}): IntegrationConnection {
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  store.integrations.set(id, connection);
  return connection;
}

export function setRunStatus(runId: string, status: BlitzRunStatus): BlitzRun | null {
  const store = getStore();
  const run = store.runs.get(runId);
  if (!run) {
    return null;
  }

  run.status = status;
  if (status === "running" && !run.startedAt) {
    run.startedAt = new Date().toISOString();
  }

  if (status === "completed" || status === "failed" || status === "partially_completed" || status === "rolled_back") {
    run.completedAt = new Date().toISOString();
  }

  return run;
}

export function addAttributionRecord(record: DailyChannelMetric): void {
  getStore().attribution.push(record);
}

function daysForWindow(window: "7d" | "30d" | "90d"): number {
  if (window === "7d") return 7;
  if (window === "30d") return 30;
  return 90;
}

export function getAttributionWindow(clientId: string, window: "7d" | "30d" | "90d"): {
  daily: BlendedDailyMetric[];
  summary: BlitzImpactSummary;
} {
  const store = getStore();
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - daysForWindow(window));

  const filtered = store.attribution.filter((row) => {
    return row.clientId === clientId && new Date(`${row.date}T00:00:00.000Z`) >= since;
  });

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

export function listOrganizations(): Organization[] {
  return [...getStore().organizations.values()];
}

export function listClientsForOrg(organizationId: string): Client[] {
  return [...getStore().clients.values()].filter((client) => client.organizationId === organizationId);
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
