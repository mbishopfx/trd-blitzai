"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./control-plane.module.css";

type OrgRole = "owner" | "admin" | "operator" | "analyst" | "client_viewer";
type AttributionWindow = "7d" | "30d" | "90d";

interface Organization {
  id: string;
  name: string;
  slug: string;
  ownerEmail?: string;
  createdAt: string;
}

interface ClientRecord {
  id: string;
  organizationId: string;
  name: string;
  timezone: string;
  websiteUrl: string | null;
  primaryLocationLabel: string | null;
  createdAt: string;
}

interface BlitzRun {
  id: string;
  organizationId: string;
  clientId: string;
  status: "created" | "running" | "completed" | "failed" | "partially_completed" | "rolled_back";
  startedAt: string | null;
  completedAt: string | null;
  createdBy: string;
  createdAt: string;
  policySnapshot: Record<string, unknown>;
  summary: Record<string, unknown> | null;
}

interface BlitzAction {
  id: string;
  runId: string;
  phase: string;
  actionType: string;
  riskTier: string;
  policyDecision: string;
  status: "pending" | "executed" | "failed" | "rolled_back" | "skipped";
  actor: "system" | "user" | "operator";
  idempotencyKey: string;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  executedAt: string | null;
}

interface BlitzAutopilotPolicy {
  clientId: string;
  maxDailyActionsPerLocation: number;
  maxActionsPerPhase: number;
  minCooldownMinutes: number;
  denyCriticalWithoutEscalation: boolean;
  enabledActionTypes: string[];
  reviewReplyAllRatingsEnabled: boolean;
  updatedAt: string;
}

interface BlitzImpactSummary {
  organizationId: string;
  clientId: string;
  locationId: string | null;
  window: AttributionWindow;
  baselineConversions: number;
  currentConversions: number;
  baselineSpend: number;
  currentSpend: number;
  blendedCostPerResult: number;
  directionalLiftPct: number;
}

interface BlendedDailyMetric {
  organizationId: string;
  clientId: string;
  locationId: string | null;
  date: string;
  impressions: number;
  clicks: number;
  calls: number;
  directions: number;
  conversions: number;
  spend: number;
  conversionValue: number;
  channels: string[];
}

interface ApiKeyRecord {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  status: string;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
}

interface FeedItem {
  id: string;
  level: "info" | "warn" | "error";
  text: string;
  createdAt: string;
}

const roleOptions: OrgRole[] = ["owner", "admin", "operator", "analyst", "client_viewer"];
const actionTypes = [
  "profile_patch",
  "media_upload",
  "post_publish",
  "review_reply",
  "hours_update",
  "attribute_update"
];

function toSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function statusClass(status: string): string {
  if (status === "running") return styles.statusRunning;
  if (status === "completed") return styles.statusCompleted;
  if (status === "failed" || status === "rolled_back") return styles.statusFailed;
  return styles.statusMuted;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

function formatDate(value: string | null): string {
  if (!value) {
    return "N/A";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function ControlPlaneDashboard() {
  const [role, setRole] = useState<OrgRole>("owner");
  const [apiKey, setApiKey] = useState("");
  const [bearerToken, setBearerToken] = useState("");

  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [orgOwnerEmail, setOrgOwnerEmail] = useState("");

  const [clientName, setClientName] = useState("");
  const [clientTimezone, setClientTimezone] = useState("America/Chicago");
  const [clientWebsite, setClientWebsite] = useState("");
  const [clientLocationLabel, setClientLocationLabel] = useState("");

  const [ga4ProviderAccount, setGa4ProviderAccount] = useState("");
  const [ga4Scopes, setGa4Scopes] = useState("https://www.googleapis.com/auth/analytics.readonly");
  const [ga4MetadataJson, setGa4MetadataJson] = useState('{"propertyId":"properties/123456789"}');

  const [adsProviderAccount, setAdsProviderAccount] = useState("");
  const [adsScopes, setAdsScopes] = useState("https://www.googleapis.com/auth/adwords");
  const [adsMetadataJson, setAdsMetadataJson] = useState('{"customerId":"123-456-7890"}');

  const [runTriggeredBy, setRunTriggeredBy] = useState("agency-operator");
  const [runPolicySnapshotJson, setRunPolicySnapshotJson] = useState('{"mode":"autonomous","source":"dashboard"}');
  const [runLookupId, setRunLookupId] = useState("");

  const [policy, setPolicy] = useState<BlitzAutopilotPolicy | null>(null);
  const [policyActionTypes, setPolicyActionTypes] = useState(actionTypes.join(", "));

  const [attributionWindow, setAttributionWindow] = useState<AttributionWindow>("30d");
  const [attributionSummary, setAttributionSummary] = useState<BlitzImpactSummary | null>(null);
  const [attributionDaily, setAttributionDaily] = useState<BlendedDailyMetric[]>([]);

  const [apiKeyName, setApiKeyName] = useState("");
  const [apiKeyScopes, setApiKeyScopes] = useState("org:read,org:write,runs:execute");
  const [apiKeyExpiresAt, setApiKeyExpiresAt] = useState("");
  const [apiKeys, setApiKeys] = useState<ApiKeyRecord[]>([]);
  const [createdApiSecret, setCreatedApiSecret] = useState("");

  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [selectedClientId, setSelectedClientId] = useState("");
  const [selectedRunId, setSelectedRunId] = useState("");
  const [recentRunIds, setRecentRunIds] = useState<string[]>([]);
  const [run, setRun] = useState<BlitzRun | null>(null);
  const [actions, setActions] = useState<BlitzAction[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const selectedOrg = useMemo(
    () => organizations.find((org) => org.id === selectedOrgId) ?? null,
    [organizations, selectedOrgId]
  );

  const selectedClient = useMemo(
    () => clients.find((client) => client.id === selectedClientId) ?? null,
    [clients, selectedClientId]
  );

  const pushFeed = useCallback((text: string, level: FeedItem["level"] = "info") => {
    const item: FeedItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      level,
      text,
      createdAt: new Date().toISOString()
    };

    setFeed((current) => [item, ...current].slice(0, 40));
  }, []);

  const request = useCallback(
    async <T,>(path: string, options?: { method?: string; body?: unknown }): Promise<T> => {
      const headers: Record<string, string> = {
        Accept: "application/json",
        "x-user-id": "dashboard-console",
        "x-role": role
      };

      if (selectedOrgId) {
        headers["x-org-id"] = selectedOrgId;
      }

      if (apiKey.trim()) {
        headers["x-api-key"] = apiKey.trim();
      }

      if (bearerToken.trim()) {
        headers.Authorization = `Bearer ${bearerToken.trim()}`;
      }

      const response = await fetch(path, {
        method: options?.method ?? "GET",
        headers: options?.body === undefined ? headers : { ...headers, "Content-Type": "application/json" },
        body: options?.body === undefined ? undefined : JSON.stringify(options.body)
      });

      const payload = (await response.json().catch(() => null)) as
        | { error?: string; details?: unknown }
        | T
        | null;

      if (!response.ok) {
        const errorMessage =
          payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
            ? payload.error
            : `${response.status} ${response.statusText}`;
        throw new Error(errorMessage);
      }

      return payload as T;
    },
    [apiKey, bearerToken, role, selectedOrgId]
  );

  const withBusy = useCallback(
    async (key: string, fn: () => Promise<void>) => {
      setBusyKey(key);
      try {
        await fn();
      } finally {
        setBusyKey(null);
      }
    },
    []
  );

  const loadOrganizations = useCallback(async () => {
    const payload = await request<{ organizations: Organization[] }>("/api/v1/orgs");
    setOrganizations(payload.organizations);
    if (!selectedOrgId && payload.organizations.length > 0) {
      setSelectedOrgId(payload.organizations[0].id);
    }
  }, [request, selectedOrgId]);

  const loadClients = useCallback(
    async (orgId: string) => {
      const payload = await request<{ clients: ClientRecord[] }>(`/api/v1/orgs/${encodeURIComponent(orgId)}/clients`);
      setClients(payload.clients);
      if (payload.clients.length === 0) {
        setSelectedClientId("");
        return;
      }
      if (!payload.clients.some((client) => client.id === selectedClientId)) {
        setSelectedClientId(payload.clients[0].id);
      }
    },
    [request, selectedClientId]
  );

  const loadApiKeys = useCallback(
    async (orgId: string) => {
      try {
        const payload = await request<{ apiKeys: ApiKeyRecord[] }>(`/api/v1/orgs/${encodeURIComponent(orgId)}/api-keys`);
        setApiKeys(payload.apiKeys);
      } catch (error) {
        pushFeed(`API key list unavailable: ${(error as Error).message}`, "warn");
      }
    },
    [pushFeed, request]
  );

  const loadPolicy = useCallback(
    async (clientId: string) => {
      const payload = await request<{ policy: BlitzAutopilotPolicy }>(
        `/api/v1/clients/${encodeURIComponent(clientId)}/autopilot/policies`
      );
      setPolicy(payload.policy);
      setPolicyActionTypes(payload.policy.enabledActionTypes.join(", "));
    },
    [request]
  );

  const loadAttribution = useCallback(
    async (clientId: string, window: AttributionWindow) => {
      const payload = await request<{ summary: BlitzImpactSummary; daily: BlendedDailyMetric[] }>(
        `/api/v1/clients/${encodeURIComponent(clientId)}/attribution?window=${window}`
      );
      setAttributionSummary(payload.summary);
      setAttributionDaily(payload.daily);
    },
    [request]
  );

  const loadRun = useCallback(
    async (runId: string) => {
      const [runPayload, actionPayload] = await Promise.all([
        request<{ run: BlitzRun }>(`/api/v1/blitz-runs/${encodeURIComponent(runId)}`),
        request<{ actions: BlitzAction[] }>(`/api/v1/blitz-runs/${encodeURIComponent(runId)}/actions`)
      ]);

      setRun(runPayload.run);
      setActions(actionPayload.actions);
      setRecentRunIds((current) => {
        if (current.includes(runId)) {
          return current;
        }
        return [runId, ...current].slice(0, 12);
      });
    },
    [request]
  );

  useEffect(() => {
    void withBusy("orgs:load", async () => {
      try {
        await loadOrganizations();
        pushFeed("Organization list loaded.");
      } catch (error) {
        pushFeed(`Failed to load organizations: ${(error as Error).message}`, "error");
      }
    });
  }, [loadOrganizations, pushFeed, withBusy]);

  useEffect(() => {
    if (!selectedOrgId) {
      setClients([]);
      setApiKeys([]);
      return;
    }

    void withBusy("org:context", async () => {
      try {
        await Promise.all([loadClients(selectedOrgId), loadApiKeys(selectedOrgId)]);
        pushFeed(`Workspace ${selectedOrgId} synced.`);
      } catch (error) {
        pushFeed(`Workspace sync failed: ${(error as Error).message}`, "error");
      }
    });
  }, [loadApiKeys, loadClients, pushFeed, selectedOrgId, withBusy]);

  useEffect(() => {
    if (!selectedClientId) {
      setPolicy(null);
      setAttributionSummary(null);
      setAttributionDaily([]);
      return;
    }

    void withBusy("client:context", async () => {
      try {
        await loadPolicy(selectedClientId);
        await loadAttribution(selectedClientId, attributionWindow);
        pushFeed(`Client ${selectedClientId} policy and attribution loaded.`);
      } catch (error) {
        pushFeed(`Client context load failed: ${(error as Error).message}`, "error");
      }
    });
  }, [attributionWindow, loadAttribution, loadPolicy, pushFeed, selectedClientId, withBusy]);

  useEffect(() => {
    if (!selectedRunId) {
      setRun(null);
      setActions([]);
      return;
    }

    void withBusy("run:load", async () => {
      try {
        await loadRun(selectedRunId);
        pushFeed(`Run ${selectedRunId} loaded.`);
      } catch (error) {
        pushFeed(`Failed to load run ${selectedRunId}: ${(error as Error).message}`, "error");
      }
    });
  }, [loadRun, pushFeed, selectedRunId, withBusy]);

  useEffect(() => {
    if (!selectedRunId || !run || (run.status !== "running" && run.status !== "created")) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadRun(selectedRunId).catch((error) => {
        pushFeed(`Run poll failed: ${(error as Error).message}`, "warn");
      });
    }, 9000);

    return () => {
      window.clearInterval(interval);
    };
  }, [loadRun, pushFeed, run, selectedRunId]);

  const handleCreateOrganization = useCallback(async () => {
    const slug = orgSlug.trim() || toSlug(orgName);
    if (!orgName.trim() || !slug || !orgOwnerEmail.trim()) {
      pushFeed("Organization name, slug, and owner email are required.", "warn");
      return;
    }

    await withBusy("org:create", async () => {
      const payload = await request<{ organization: Organization }>("/api/v1/orgs", {
        method: "POST",
        body: {
          name: orgName.trim(),
          slug,
          ownerEmail: orgOwnerEmail.trim()
        }
      });

      setOrganizations((current) => [payload.organization, ...current]);
      setSelectedOrgId(payload.organization.id);
      setOrgName("");
      setOrgSlug("");
      setOrgOwnerEmail("");
      pushFeed(`Organization created: ${payload.organization.name}`);
    });
  }, [orgName, orgOwnerEmail, orgSlug, pushFeed, request, withBusy]);

  const handleCreateClient = useCallback(async () => {
    if (!selectedOrgId) {
      pushFeed("Select an organization before creating a client.", "warn");
      return;
    }

    if (!clientName.trim()) {
      pushFeed("Client name is required.", "warn");
      return;
    }

    await withBusy("client:create", async () => {
      const payload = await request<{ client: ClientRecord }>(`/api/v1/orgs/${encodeURIComponent(selectedOrgId)}/clients`, {
        method: "POST",
        body: {
          name: clientName.trim(),
          timezone: clientTimezone.trim() || "America/Chicago",
          websiteUrl: clientWebsite.trim() || undefined,
          primaryLocationLabel: clientLocationLabel.trim() || undefined
        }
      });

      setClients((current) => [payload.client, ...current]);
      setSelectedClientId(payload.client.id);
      setClientName("");
      setClientWebsite("");
      setClientLocationLabel("");
      pushFeed(`Client created: ${payload.client.name}`);
    });
  }, [clientLocationLabel, clientName, clientTimezone, clientWebsite, pushFeed, request, selectedOrgId, withBusy]);

  const handleGbpOAuth = useCallback(async () => {
    if (!selectedClientId) {
      pushFeed("Select a client before connecting GBP OAuth.", "warn");
      return;
    }

    await withBusy("gbp:oauth", async () => {
      const payload = await request<{ authUrl: string }>(
        `/api/v1/gbp/oauth/start?clientId=${encodeURIComponent(selectedClientId)}&returnPath=/`
      );
      window.open(payload.authUrl, "_blank", "noopener,noreferrer");
      pushFeed("Opened GBP OAuth window.");
    });
  }, [pushFeed, request, selectedClientId, withBusy]);

  const handleConnectGa4 = useCallback(async () => {
    if (!selectedClientId || !ga4ProviderAccount.trim()) {
      pushFeed("Client and GA4 provider account ID are required.", "warn");
      return;
    }

    let metadata: Record<string, unknown> = {};
    try {
      metadata = ga4MetadataJson.trim() ? (JSON.parse(ga4MetadataJson) as Record<string, unknown>) : {};
    } catch (error) {
      pushFeed(`GA4 metadata JSON is invalid: ${(error as Error).message}`, "error");
      return;
    }

    await withBusy("ga4:connect", async () => {
      await request(`/api/v1/clients/${encodeURIComponent(selectedClientId)}/integrations/ga4/connect`, {
        method: "POST",
        body: {
          providerAccountId: ga4ProviderAccount.trim(),
          scopes: splitCsv(ga4Scopes),
          metadata
        }
      });
      pushFeed("GA4 integration saved.");
    });
  }, [ga4MetadataJson, ga4ProviderAccount, ga4Scopes, pushFeed, request, selectedClientId, withBusy]);

  const handleConnectAds = useCallback(async () => {
    if (!selectedClientId || !adsProviderAccount.trim()) {
      pushFeed("Client and Google Ads provider account ID are required.", "warn");
      return;
    }

    let metadata: Record<string, unknown> = {};
    try {
      metadata = adsMetadataJson.trim() ? (JSON.parse(adsMetadataJson) as Record<string, unknown>) : {};
    } catch (error) {
      pushFeed(`Google Ads metadata JSON is invalid: ${(error as Error).message}`, "error");
      return;
    }

    await withBusy("ads:connect", async () => {
      await request(`/api/v1/clients/${encodeURIComponent(selectedClientId)}/integrations/google-ads/connect`, {
        method: "POST",
        body: {
          providerAccountId: adsProviderAccount.trim(),
          scopes: splitCsv(adsScopes),
          metadata
        }
      });
      pushFeed("Google Ads integration saved.");
    });
  }, [adsMetadataJson, adsProviderAccount, adsScopes, pushFeed, request, selectedClientId, withBusy]);

  const handleLaunchRun = useCallback(async () => {
    if (!selectedClientId || !runTriggeredBy.trim()) {
      pushFeed("Client and triggeredBy are required to launch a run.", "warn");
      return;
    }

    let policySnapshot: Record<string, unknown> = {};
    try {
      policySnapshot = runPolicySnapshotJson.trim()
        ? (JSON.parse(runPolicySnapshotJson) as Record<string, unknown>)
        : {};
    } catch (error) {
      pushFeed(`Policy snapshot JSON is invalid: ${(error as Error).message}`, "error");
      return;
    }

    await withBusy("run:create", async () => {
      const payload = await request<{ run: BlitzRun }>(`/api/v1/clients/${encodeURIComponent(selectedClientId)}/blitz-runs`, {
        method: "POST",
        body: {
          triggeredBy: runTriggeredBy.trim(),
          policySnapshot
        }
      });

      setSelectedRunId(payload.run.id);
      setRunLookupId(payload.run.id);
      pushFeed(`Blitz run launched: ${payload.run.id}`);
    });
  }, [pushFeed, request, runPolicySnapshotJson, runTriggeredBy, selectedClientId, withBusy]);

  const handleFindRun = useCallback(async () => {
    if (!runLookupId.trim()) {
      pushFeed("Enter a run ID.", "warn");
      return;
    }

    setSelectedRunId(runLookupId.trim());
  }, [pushFeed, runLookupId]);

  const handleRollbackAction = useCallback(
    async (actionId: string) => {
      const reason = window.prompt("Rollback reason", "operator rollback");
      if (reason === null) {
        return;
      }

      await withBusy(`rollback:${actionId}`, async () => {
        await request(`/api/v1/blitz-actions/${encodeURIComponent(actionId)}/rollback`, {
          method: "POST",
          body: {
            reason: reason.trim() || "operator rollback"
          }
        });

        if (selectedRunId) {
          await loadRun(selectedRunId);
        }
        pushFeed(`Rollback executed for action ${actionId}.`, "warn");
      });
    },
    [loadRun, pushFeed, request, selectedRunId, withBusy]
  );

  const handleSavePolicy = useCallback(async () => {
    if (!selectedClientId || !policy) {
      pushFeed("Select a client before saving policy.", "warn");
      return;
    }

    await withBusy("policy:save", async () => {
      const payload = await request<{ policy: BlitzAutopilotPolicy }>(
        `/api/v1/clients/${encodeURIComponent(selectedClientId)}/autopilot/policies`,
        {
          method: "POST",
          body: {
            maxDailyActionsPerLocation: policy.maxDailyActionsPerLocation,
            maxActionsPerPhase: policy.maxActionsPerPhase,
            minCooldownMinutes: policy.minCooldownMinutes,
            denyCriticalWithoutEscalation: policy.denyCriticalWithoutEscalation,
            enabledActionTypes: splitCsv(policyActionTypes),
            reviewReplyAllRatingsEnabled: policy.reviewReplyAllRatingsEnabled
          }
        }
      );
      setPolicy(payload.policy);
      setPolicyActionTypes(payload.policy.enabledActionTypes.join(", "));
      pushFeed("Autopilot policy saved.");
    });
  }, [policy, policyActionTypes, pushFeed, request, selectedClientId, withBusy]);

  const handleCreateApiKey = useCallback(async () => {
    if (!selectedOrgId || !apiKeyName.trim()) {
      pushFeed("Organization and API key name are required.", "warn");
      return;
    }

    await withBusy("apikey:create", async () => {
      const payload = await request<{
        apiKey: { id: string; keyPrefix: string; secret: string };
      }>(`/api/v1/orgs/${encodeURIComponent(selectedOrgId)}/api-keys`, {
        method: "POST",
        body: {
          name: apiKeyName.trim(),
          scopes: splitCsv(apiKeyScopes),
          expiresAt: apiKeyExpiresAt.trim() || undefined,
          metadata: {}
        }
      });

      setCreatedApiSecret(payload.apiKey.secret);
      setApiKeyName("");
      setApiKeyExpiresAt("");
      await loadApiKeys(selectedOrgId);
      pushFeed(`API key created with prefix ${payload.apiKey.keyPrefix}.`);
    });
  }, [apiKeyExpiresAt, apiKeyName, apiKeyScopes, loadApiKeys, pushFeed, request, selectedOrgId, withBusy]);

  const runStatus = run?.status ?? "no run selected";
  const healthState = run?.status === "failed" || run?.status === "rolled_back" ? "degraded" : "operational";

  return (
    <main className={styles.shell}>
      <section className={styles.hero}>
        <h1 className={styles.title}>Blitz AI Agent Control Plane</h1>
        <p className={styles.subtitle}>
          Enterprise operator console for onboarding, integrations, policy-governed autonomous runs, rollback control,
          and blended GBP + GA4 + Google Ads attribution.
        </p>
        <div className={styles.heroRow}>
          <span className={styles.pill}>System: {healthState}</span>
          <span className={styles.pill}>Active Run: {runStatus}</span>
          <span className={styles.pill}>Workspace: {selectedOrg?.name ?? "none"}</span>
          <span className={styles.pill}>Client: {selectedClient?.name ?? "none"}</span>
        </div>
        <div className={styles.authControls}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Operator Role Header</span>
            <select className={styles.select} value={role} onChange={(event) => setRole(event.target.value as OrgRole)}>
              {roleOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>API Key Header (Optional)</span>
            <input
              className={`${styles.input} ${styles.mono}`}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="blitz_..."
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Bearer Token (Optional)</span>
            <input
              className={`${styles.input} ${styles.mono}`}
              value={bearerToken}
              onChange={(event) => setBearerToken(event.target.value)}
              placeholder="eyJ..."
            />
          </label>
          <div className={styles.buttonRow}>
            <button
              className={`${styles.btnSecondary} ${busyKey ? styles.disabled : ""}`}
              onClick={() => {
                void withBusy("orgs:manual-load", async () => {
                  await loadOrganizations();
                  pushFeed("Organization list refreshed.");
                });
              }}
              disabled={Boolean(busyKey)}
            >
              Refresh Organizations
            </button>
          </div>
        </div>
      </section>

      <section className={styles.layout}>
        <div className={styles.column}>
          <article className={styles.card}>
            <header className={styles.cardHeader}>
              <div>
                <h2 className={styles.cardTitle}>Onboarding Wizard</h2>
                <p className={styles.cardHint}>Create org / create client / connect integrations / launch Blitz.</p>
              </div>
            </header>
            <div className={styles.stepList}>
              <section className={styles.step}>
                <h3 className={styles.stepTitle}>1. Organization</h3>
                <div className={styles.fieldGrid}>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Name</span>
                    <input className={styles.input} value={orgName} onChange={(event) => setOrgName(event.target.value)} />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Slug</span>
                    <input
                      className={`${styles.input} ${styles.mono}`}
                      value={orgSlug}
                      onChange={(event) => setOrgSlug(event.target.value)}
                      placeholder={toSlug(orgName)}
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Owner Email</span>
                    <input
                      className={styles.input}
                      value={orgOwnerEmail}
                      onChange={(event) => setOrgOwnerEmail(event.target.value)}
                      placeholder="owner@agency.com"
                    />
                  </label>
                </div>
                <button
                  className={`${styles.btnPrimary} ${busyKey ? styles.disabled : ""}`}
                  onClick={() => void handleCreateOrganization()}
                  disabled={Boolean(busyKey)}
                >
                  Create Organization
                </button>
              </section>

              <section className={styles.step}>
                <h3 className={styles.stepTitle}>2. Client Workspace</h3>
                <p className={styles.stepNote}>Target org: {selectedOrg?.name ?? "none selected"}</p>
                <div className={styles.fieldGrid}>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Client Name</span>
                    <input
                      className={styles.input}
                      value={clientName}
                      onChange={(event) => setClientName(event.target.value)}
                      placeholder="True Rank Digital - Dallas"
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Timezone</span>
                    <input
                      className={styles.input}
                      value={clientTimezone}
                      onChange={(event) => setClientTimezone(event.target.value)}
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Website URL</span>
                    <input
                      className={styles.input}
                      value={clientWebsite}
                      onChange={(event) => setClientWebsite(event.target.value)}
                      placeholder="https://example.com"
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Primary Location Label</span>
                    <input
                      className={styles.input}
                      value={clientLocationLabel}
                      onChange={(event) => setClientLocationLabel(event.target.value)}
                      placeholder="Dallas, TX"
                    />
                  </label>
                </div>
                <button
                  className={`${styles.btnPrimary} ${busyKey || !selectedOrgId ? styles.disabled : ""}`}
                  onClick={() => void handleCreateClient()}
                  disabled={Boolean(busyKey) || !selectedOrgId}
                >
                  Create Client
                </button>
              </section>

              <section className={styles.step}>
                <h3 className={styles.stepTitle}>3. Integrations</h3>
                <p className={styles.stepNote}>Target client: {selectedClient?.name ?? "none selected"}</p>
                <div className={styles.buttonRow}>
                  <button
                    className={`${styles.btnSecondary} ${busyKey || !selectedClientId ? styles.disabled : ""}`}
                    onClick={() => void handleGbpOAuth()}
                    disabled={Boolean(busyKey) || !selectedClientId}
                  >
                    Start GBP OAuth
                  </button>
                </div>
                <div className={styles.fieldGrid}>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>GA4 Provider Account</span>
                    <input
                      className={`${styles.input} ${styles.mono}`}
                      value={ga4ProviderAccount}
                      onChange={(event) => setGa4ProviderAccount(event.target.value)}
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>GA4 Scopes (CSV)</span>
                    <input className={styles.input} value={ga4Scopes} onChange={(event) => setGa4Scopes(event.target.value)} />
                  </label>
                </div>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>GA4 Metadata JSON</span>
                  <textarea
                    className={styles.textarea}
                    value={ga4MetadataJson}
                    onChange={(event) => setGa4MetadataJson(event.target.value)}
                  />
                </label>
                <button
                  className={`${styles.btnSecondary} ${busyKey || !selectedClientId ? styles.disabled : ""}`}
                  onClick={() => void handleConnectGa4()}
                  disabled={Boolean(busyKey) || !selectedClientId}
                >
                  Save GA4 Connection
                </button>

                <div className={styles.fieldGrid}>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Ads Provider Account</span>
                    <input
                      className={`${styles.input} ${styles.mono}`}
                      value={adsProviderAccount}
                      onChange={(event) => setAdsProviderAccount(event.target.value)}
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Ads Scopes (CSV)</span>
                    <input className={styles.input} value={adsScopes} onChange={(event) => setAdsScopes(event.target.value)} />
                  </label>
                </div>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Google Ads Metadata JSON</span>
                  <textarea
                    className={styles.textarea}
                    value={adsMetadataJson}
                    onChange={(event) => setAdsMetadataJson(event.target.value)}
                  />
                </label>
                <button
                  className={`${styles.btnSecondary} ${busyKey || !selectedClientId ? styles.disabled : ""}`}
                  onClick={() => void handleConnectAds()}
                  disabled={Boolean(busyKey) || !selectedClientId}
                >
                  Save Google Ads Connection
                </button>
              </section>

              <section className={styles.step}>
                <h3 className={styles.stepTitle}>4. Launch Blitz Protocol</h3>
                <div className={styles.fieldGrid}>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Triggered By</span>
                    <input
                      className={styles.input}
                      value={runTriggeredBy}
                      onChange={(event) => setRunTriggeredBy(event.target.value)}
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Lookup Run ID</span>
                    <input
                      className={`${styles.input} ${styles.mono}`}
                      value={runLookupId}
                      onChange={(event) => setRunLookupId(event.target.value)}
                      placeholder="run uuid"
                    />
                  </label>
                </div>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Policy Snapshot JSON</span>
                  <textarea
                    className={styles.textarea}
                    value={runPolicySnapshotJson}
                    onChange={(event) => setRunPolicySnapshotJson(event.target.value)}
                  />
                </label>
                <div className={styles.buttonRow}>
                  <button
                    className={`${styles.btnPrimary} ${busyKey || !selectedClientId ? styles.disabled : ""}`}
                    onClick={() => void handleLaunchRun()}
                    disabled={Boolean(busyKey) || !selectedClientId}
                  >
                    Launch Blitz Run
                  </button>
                  <button
                    className={`${styles.btnGhost} ${busyKey ? styles.disabled : ""}`}
                    onClick={() => void handleFindRun()}
                    disabled={Boolean(busyKey)}
                  >
                    Load Run
                  </button>
                </div>
              </section>
            </div>
          </article>

          <article className={styles.card}>
            <header className={styles.cardHeader}>
              <div>
                <h2 className={styles.cardTitle}>Admin and API Keys</h2>
                <p className={styles.cardHint}>Create scoped org keys for automation connectors and operators.</p>
              </div>
            </header>
            <div className={styles.fieldGrid}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Key Name</span>
                <input className={styles.input} value={apiKeyName} onChange={(event) => setApiKeyName(event.target.value)} />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Scopes (CSV)</span>
                <input className={styles.input} value={apiKeyScopes} onChange={(event) => setApiKeyScopes(event.target.value)} />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Expires At (ISO)</span>
                <input
                  className={`${styles.input} ${styles.mono}`}
                  value={apiKeyExpiresAt}
                  onChange={(event) => setApiKeyExpiresAt(event.target.value)}
                  placeholder="2026-12-31T00:00:00.000Z"
                />
              </label>
            </div>
            <div className={styles.buttonRow}>
              <button
                className={`${styles.btnSecondary} ${busyKey || !selectedOrgId ? styles.disabled : ""}`}
                onClick={() => void handleCreateApiKey()}
                disabled={Boolean(busyKey) || !selectedOrgId}
              >
                Create API Key
              </button>
              <button
                className={`${styles.btnGhost} ${busyKey || !selectedOrgId ? styles.disabled : ""}`}
                onClick={() => {
                  if (!selectedOrgId) return;
                  void withBusy("apikey:refresh", async () => {
                    await loadApiKeys(selectedOrgId);
                    pushFeed("API keys refreshed.");
                  });
                }}
                disabled={Boolean(busyKey) || !selectedOrgId}
              >
                Refresh Keys
              </button>
            </div>
            {createdApiSecret ? (
              <div className={styles.listItem}>
                <p className={styles.itemTitle}>New key secret (shown once)</p>
                <p className={`${styles.itemMeta} ${styles.mono}`}>{createdApiSecret}</p>
              </div>
            ) : null}
            <ul className={styles.list}>
              {apiKeys.length === 0 ? (
                <li className={styles.listItem}>
                  <p className={styles.itemTitle}>No API keys found</p>
                  <p className={styles.itemMeta}>Create one to enable `x-api-key` based access.</p>
                </li>
              ) : (
                apiKeys.map((item) => (
                  <li key={item.id} className={styles.listItem}>
                    <p className={styles.itemTitle}>
                      {item.name} <span className={`${styles.status} ${statusClass(item.status)}`}>{item.status}</span>
                    </p>
                    <p className={styles.itemMeta}>
                      {item.key_prefix} | scopes: {item.scopes.join(", ") || "none"}
                    </p>
                    <p className={styles.itemMeta}>
                      last used: {formatDate(item.last_used_at)} | expires: {formatDate(item.expires_at)}
                    </p>
                  </li>
                ))
              )}
            </ul>
          </article>
        </div>

        <div className={styles.column}>
          <article className={styles.card}>
            <header className={styles.cardHeader}>
              <div>
                <h2 className={styles.cardTitle}>Workspace and Clients</h2>
                <p className={styles.cardHint}>Switch org/client context for all live API calls.</p>
              </div>
            </header>
            <div className={styles.split}>
              <div>
                <p className={styles.fieldLabel}>Organizations</p>
                <ul className={styles.list}>
                  {organizations.length === 0 ? (
                    <li className={styles.listItem}>
                      <p className={styles.itemTitle}>No organizations loaded</p>
                    </li>
                  ) : (
                    organizations.map((org) => (
                      <li
                        key={org.id}
                        className={`${styles.listItem} ${selectedOrgId === org.id ? styles.activeItem : ""}`}
                      >
                        <button
                          className={styles.btnGhost}
                          onClick={() => setSelectedOrgId(org.id)}
                          style={{ width: "100%", textAlign: "left" }}
                        >
                          <p className={styles.itemTitle}>{org.name}</p>
                          <p className={styles.itemMeta}>
                            {org.slug} | {org.ownerEmail ?? "owner email not set"}
                          </p>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </div>
              <div>
                <p className={styles.fieldLabel}>Clients</p>
                <ul className={styles.list}>
                  {clients.length === 0 ? (
                    <li className={styles.listItem}>
                      <p className={styles.itemTitle}>No clients in this org</p>
                    </li>
                  ) : (
                    clients.map((client) => (
                      <li
                        key={client.id}
                        className={`${styles.listItem} ${selectedClientId === client.id ? styles.activeItem : ""}`}
                      >
                        <button
                          className={styles.btnGhost}
                          onClick={() => setSelectedClientId(client.id)}
                          style={{ width: "100%", textAlign: "left" }}
                        >
                          <p className={styles.itemTitle}>{client.name}</p>
                          <p className={styles.itemMeta}>
                            {client.timezone} | {client.websiteUrl ?? "no website"}
                          </p>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            </div>
          </article>

          <article className={styles.card}>
            <header className={styles.cardHeader}>
              <div>
                <h2 className={styles.cardTitle}>Run Monitor</h2>
                <p className={styles.cardHint}>Track run progression and execute rollback per action.</p>
              </div>
              <div className={styles.buttonRow}>
                <button
                  className={`${styles.btnGhost} ${busyKey || !selectedRunId ? styles.disabled : ""}`}
                  onClick={() => {
                    if (!selectedRunId) return;
                    void withBusy("run:refresh", async () => {
                      await loadRun(selectedRunId);
                    });
                  }}
                  disabled={Boolean(busyKey) || !selectedRunId}
                >
                  Refresh Run
                </button>
              </div>
            </header>

            <div className={styles.summaryGrid}>
              <div className={styles.metric}>
                <span className={styles.metricLabel}>Run ID</span>
                <p className={`${styles.metricValue} ${styles.mono}`}>{run?.id.slice(0, 12) ?? "--"}</p>
              </div>
              <div className={styles.metric}>
                <span className={styles.metricLabel}>Status</span>
                <p className={styles.metricValue}>{run?.status ?? "--"}</p>
              </div>
              <div className={styles.metric}>
                <span className={styles.metricLabel}>Started</span>
                <p className={styles.metricValue}>{run?.startedAt ? formatDate(run.startedAt).split(",")[0] : "--"}</p>
              </div>
              <div className={styles.metric}>
                <span className={styles.metricLabel}>Completed</span>
                <p className={styles.metricValue}>
                  {run?.completedAt ? formatDate(run.completedAt).split(",")[0] : run?.status === "running" ? "In progress" : "--"}
                </p>
              </div>
            </div>

            {recentRunIds.length > 0 ? (
              <div className={styles.buttonRow}>
                {recentRunIds.map((runId) => (
                  <button
                    key={runId}
                    className={`${styles.btnGhost} ${selectedRunId === runId ? styles.activeItem : ""}`}
                    onClick={() => setSelectedRunId(runId)}
                  >
                    <span className={styles.mono}>{runId.slice(0, 12)}</span>
                  </button>
                ))}
              </div>
            ) : null}

            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Phase</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Risk</th>
                    <th>Decision</th>
                    <th>Error</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {actions.length === 0 ? (
                    <tr>
                      <td colSpan={7}>No actions loaded for this run.</td>
                    </tr>
                  ) : (
                    actions.map((action) => (
                      <tr key={action.id}>
                        <td>{action.phase}</td>
                        <td>{action.actionType}</td>
                        <td>
                          <span className={`${styles.status} ${statusClass(action.status)}`}>{action.status}</span>
                        </td>
                        <td>{action.riskTier}</td>
                        <td>{action.policyDecision}</td>
                        <td>{action.error ?? "--"}</td>
                        <td>
                          <button
                            className={`${styles.btnDanger} ${busyKey ? styles.disabled : ""}`}
                            onClick={() => void handleRollbackAction(action.id)}
                            disabled={Boolean(busyKey)}
                          >
                            Rollback
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </article>

          <article className={styles.card}>
            <header className={styles.cardHeader}>
              <div>
                <h2 className={styles.cardTitle}>Autopilot Policy</h2>
                <p className={styles.cardHint}>Risk gates, action limits, and all-rating review response controls.</p>
              </div>
            </header>
            {!policy ? (
              <p className={styles.cardHint}>Select a client to load policy.</p>
            ) : (
              <>
                <div className={styles.fieldGrid}>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Max Daily Actions / Location</span>
                    <input
                      className={styles.input}
                      type="number"
                      value={policy.maxDailyActionsPerLocation}
                      onChange={(event) =>
                        setPolicy((current) =>
                          current
                            ? {
                                ...current,
                                maxDailyActionsPerLocation: Number(event.target.value)
                              }
                            : current
                        )
                      }
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Max Actions / Phase</span>
                    <input
                      className={styles.input}
                      type="number"
                      value={policy.maxActionsPerPhase}
                      onChange={(event) =>
                        setPolicy((current) =>
                          current
                            ? {
                                ...current,
                                maxActionsPerPhase: Number(event.target.value)
                              }
                            : current
                        )
                      }
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Cooldown Minutes</span>
                    <input
                      className={styles.input}
                      type="number"
                      value={policy.minCooldownMinutes}
                      onChange={(event) =>
                        setPolicy((current) =>
                          current
                            ? {
                                ...current,
                                minCooldownMinutes: Number(event.target.value)
                              }
                            : current
                        )
                      }
                    />
                  </label>
                </div>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Enabled Action Types (CSV)</span>
                  <input
                    className={styles.input}
                    value={policyActionTypes}
                    onChange={(event) => setPolicyActionTypes(event.target.value)}
                  />
                </label>
                <div className={styles.buttonRow}>
                  <button
                    className={`${styles.btnSecondary} ${busyKey ? styles.disabled : ""}`}
                    onClick={() =>
                      setPolicy((current) =>
                        current
                          ? {
                              ...current,
                              denyCriticalWithoutEscalation: !current.denyCriticalWithoutEscalation
                            }
                          : current
                      )
                    }
                    disabled={Boolean(busyKey)}
                  >
                    Critical Escalation: {policy.denyCriticalWithoutEscalation ? "Required" : "Not Required"}
                  </button>
                  <button
                    className={`${styles.btnSecondary} ${busyKey ? styles.disabled : ""}`}
                    onClick={() =>
                      setPolicy((current) =>
                        current
                          ? {
                              ...current,
                              reviewReplyAllRatingsEnabled: !current.reviewReplyAllRatingsEnabled
                            }
                          : current
                      )
                    }
                    disabled={Boolean(busyKey)}
                  >
                    Review Replies (All Ratings): {policy.reviewReplyAllRatingsEnabled ? "Enabled" : "Disabled"}
                  </button>
                  <button
                    className={`${styles.btnPrimary} ${busyKey ? styles.disabled : ""}`}
                    onClick={() => void handleSavePolicy()}
                    disabled={Boolean(busyKey)}
                  >
                    Save Policy
                  </button>
                </div>
              </>
            )}
          </article>

          <article className={styles.card}>
            <header className={styles.cardHeader}>
              <div>
                <h2 className={styles.cardTitle}>Attribution Panel</h2>
                <p className={styles.cardHint}>Blended GBP + GA4 + Google Ads impact view.</p>
              </div>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Window</span>
                <select
                  className={styles.select}
                  value={attributionWindow}
                  onChange={(event) => setAttributionWindow(event.target.value as AttributionWindow)}
                >
                  <option value="7d">7d</option>
                  <option value="30d">30d</option>
                  <option value="90d">90d</option>
                </select>
              </label>
            </header>
            {!attributionSummary ? (
              <p className={styles.cardHint}>No attribution data yet for this client/window.</p>
            ) : (
              <>
                <div className={styles.summaryGrid}>
                  <div className={styles.metric}>
                    <span className={styles.metricLabel}>Current Conversions</span>
                    <p className={styles.metricValue}>{formatNumber(attributionSummary.currentConversions)}</p>
                  </div>
                  <div className={styles.metric}>
                    <span className={styles.metricLabel}>Current Spend</span>
                    <p className={styles.metricValue}>{formatCurrency(attributionSummary.currentSpend)}</p>
                  </div>
                  <div className={styles.metric}>
                    <span className={styles.metricLabel}>Cost Per Result</span>
                    <p className={styles.metricValue}>{formatCurrency(attributionSummary.blendedCostPerResult)}</p>
                  </div>
                  <div className={styles.metric}>
                    <span className={styles.metricLabel}>Directional Lift</span>
                    <p className={styles.metricValue}>{formatNumber(attributionSummary.directionalLiftPct)}%</p>
                  </div>
                </div>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Channels</th>
                        <th>Impressions</th>
                        <th>Clicks</th>
                        <th>Conversions</th>
                        <th>Spend</th>
                        <th>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {attributionDaily.length === 0 ? (
                        <tr>
                          <td colSpan={7}>No daily rows.</td>
                        </tr>
                      ) : (
                        attributionDaily.map((row) => (
                          <tr key={`${row.date}-${row.locationId ?? "none"}`}>
                            <td>{row.date}</td>
                            <td>{row.channels.join(", ")}</td>
                            <td>{formatNumber(row.impressions)}</td>
                            <td>{formatNumber(row.clicks)}</td>
                            <td>{formatNumber(row.conversions)}</td>
                            <td>{formatCurrency(row.spend)}</td>
                            <td>{formatCurrency(row.conversionValue)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </article>

          <article className={styles.card}>
            <header className={styles.cardHeader}>
              <div>
                <h2 className={styles.cardTitle}>Billing and Usage Snapshot</h2>
                <p className={styles.cardHint}>Operator-side estimate view mapped to run and attribution activity.</p>
              </div>
            </header>
            <div className={styles.summaryGrid}>
              <div className={styles.metric}>
                <span className={styles.metricLabel}>Plan</span>
                <p className={styles.metricValue}>Enterprise v1</p>
              </div>
              <div className={styles.metric}>
                <span className={styles.metricLabel}>Actions This Run</span>
                <p className={styles.metricValue}>{actions.length ? formatNumber(actions.length) : "--"}</p>
              </div>
              <div className={styles.metric}>
                <span className={styles.metricLabel}>Media/Content Activity</span>
                <p className={styles.metricValue}>
                  {actions.length
                    ? formatNumber(
                        actions.filter((item) => item.actionType === "media_upload" || item.actionType === "post_publish").length
                      )
                    : "--"}
                </p>
              </div>
              <div className={styles.metric}>
                <span className={styles.metricLabel}>Ad Spend (Window)</span>
                <p className={styles.metricValue}>{attributionSummary ? formatCurrency(attributionSummary.currentSpend) : "--"}</p>
              </div>
            </div>
            <p className={styles.cardHint}>
              Stripe subscription, metering, and invoice reconciliation are wired server-side and can plug into this panel once
              billing endpoints are exposed.
            </p>
          </article>

          <article className={styles.card}>
            <header className={styles.cardHeader}>
              <div>
                <h2 className={styles.cardTitle}>Operator Timeline</h2>
                <p className={styles.cardHint}>Live feedback stream for wizard actions and monitor requests.</p>
              </div>
            </header>
            <ul className={styles.feed}>
              {feed.length === 0 ? (
                <li className={`${styles.feedItem} ${styles.feedInfo}`}>
                  <span className={styles.feedMeta}>no events</span>
                  <span>Use the onboarding panels to start generating run events.</span>
                </li>
              ) : (
                feed.map((item) => (
                  <li
                    key={item.id}
                    className={`${styles.feedItem} ${
                      item.level === "error" ? styles.feedError : item.level === "warn" ? styles.feedWarn : styles.feedInfo
                    }`}
                  >
                    <span className={styles.feedMeta}>
                      {item.level} | {formatDate(item.createdAt)}
                    </span>
                    <span>{item.text}</span>
                  </li>
                ))
              )}
            </ul>
          </article>
        </div>
      </section>
    </main>
  );
}
