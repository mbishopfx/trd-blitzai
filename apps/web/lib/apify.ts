import { randomUUID } from "node:crypto";
import { URL } from "node:url";
import { ApifyClient } from "apify-client";
import { getSupabaseServiceClient, isSupabaseConfigured } from "./supabase";

export const apifyActionKeys = [
  "brand_rankings",
  "answer_engine_seo",
  "site_crawl",
  "local_listings"
] as const;

export type ApifyActionKey = (typeof apifyActionKeys)[number];

export interface ApifyWorkspaceClient {
  id: string;
  organizationId: string;
  name: string;
  websiteUrl: string | null;
  primaryLocationLabel: string | null;
}

export interface ApifyRunRecord {
  id: string;
  organizationId: string;
  clientId: string;
  actionKey: ApifyActionKey;
  label: string;
  status: "running" | "succeeded" | "failed";
  sourceType: "actor" | "task";
  sourceId: string;
  apifyRunId: string | null;
  datasetId: string | null;
  inputSummary: string[];
  summaryLines: string[];
  previewItems: Array<Record<string, unknown>>;
  error: string | null;
  createdBy: string;
  createdAt: string;
  finishedAt: string | null;
  updatedAt: string;
}

interface ApifyActionDefinition {
  key: ApifyActionKey;
  label: string;
  actorId: string;
  actorEnvKey: string;
  taskEnvKey: string;
  buildInput: (client: ApifyWorkspaceClient) => Record<string, unknown>;
  buildInputSummary: (client: ApifyWorkspaceClient) => string[];
  summarize: (client: ApifyWorkspaceClient, previewItems: Array<Record<string, unknown>>) => string[];
}

interface ApifyTokenEntry {
  token: string;
  index: number;
}

const globalApifyStore = globalThis as typeof globalThis & {
  __aiblitzApifyRuns?: ApifyRunRecord[];
};

function getHostName(websiteUrl: string | null): string | null {
  if (!websiteUrl) {
    return null;
  }

  try {
    const url = new URL(websiteUrl);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function buildBrandQueries(client: ApifyWorkspaceClient): string[] {
  const location = client.primaryLocationLabel?.trim();

  return [
    client.name,
    [client.name, location].filter(Boolean).join(" "),
    `${client.name} reviews`,
    `${client.name} official website`
  ];
}

function buildAnswerQueries(client: ApifyWorkspaceClient): string[] {
  const location = client.primaryLocationLabel?.trim();
  const hostName = getHostName(client.websiteUrl);

  return [
    `best information about ${client.name}`,
    [client.name, location, "services"].filter(Boolean).join(" "),
    hostName ? `${hostName} reputation` : `${client.name} reputation`,
    `${client.name} near me`
  ];
}

function sanitizePreviewValue(value: unknown, depth = 0): unknown {
  if (depth > 3) {
    return "[truncated]";
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return value.length > 320 ? `${value.slice(0, 317)}...` : value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 8).map((entry) => sanitizePreviewValue(entry, depth + 1));
  }

  if (typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    const sanitizedEntries = Object.entries(objectValue)
      .slice(0, 16)
      .map(([key, entryValue]) => [key, sanitizePreviewValue(entryValue, depth + 1)]);

    return Object.fromEntries(sanitizedEntries);
  }

  return String(value);
}

function sanitizePreviewItems(items: unknown[]): Array<Record<string, unknown>> {
  return items
    .slice(0, 5)
    .map((item) => sanitizePreviewValue(item))
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)));
}

function stringifyPreview(item: unknown): string {
  try {
    return JSON.stringify(item).toLowerCase();
  } catch {
    return "";
  }
}

function countBrandMentions(items: Array<Record<string, unknown>>, client: ApifyWorkspaceClient): number {
  const hostName = getHostName(client.websiteUrl);
  const needles = [client.name.toLowerCase()];

  if (hostName) {
    needles.push(hostName.toLowerCase());
  }

  return items.filter((item) => {
    const haystack = stringifyPreview(item);
    return needles.some((needle) => haystack.includes(needle));
  }).length;
}

function firstString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const resolved = firstString(entry);
      if (resolved) {
        return resolved;
      }
    }
  }

  if (value && typeof value === "object") {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      const resolved = firstString(entry);
      if (resolved) {
        return resolved;
      }
    }
  }

  return null;
}

function extractUrls(items: Array<Record<string, unknown>>): string[] {
  return items
    .map((item) => firstString(item))
    .filter((value): value is string => Boolean(value))
    .filter((value) => value.startsWith("http://") || value.startsWith("https://"));
}

const apifyDefinitions: Record<ApifyActionKey, ApifyActionDefinition> = {
  brand_rankings: {
    key: "brand_rankings",
    label: "AI Brand Rankings",
    actorId: "apify/google-search-scraper",
    actorEnvKey: "APIFY_ACTOR_BRAND_RANKINGS",
    taskEnvKey: "APIFY_TASK_BRAND_RANKINGS",
    buildInput: (client) => ({
      queries: buildBrandQueries(client).join("\n"),
      countryCode: "us",
      languageCode: "en",
      resultsPerPage: 10,
      maxPagesPerQuery: 1,
      aiModeSearch: {
        enableAiMode: true
      },
      perplexitySearch: {
        enablePerplexity: true
      },
      chatGptSearch: {
        enableChatGpt: true
      }
    }),
    buildInputSummary: (client) => [
      `Queries: ${buildBrandQueries(client).join(" | ")}`,
      `Location seed: ${client.primaryLocationLabel ?? "not set"}`,
      `Website seed: ${client.websiteUrl ?? "not set"}`
    ],
    summarize: (client, previewItems) => {
      const mentionCount = countBrandMentions(previewItems, client);

      return [
        `Retrieved ${previewItems.length} preview rows from Apify search results.`,
        mentionCount
          ? `The brand or domain appeared in ${mentionCount} preview rows.`
          : "No direct brand/domain match was found in the preview rows.",
        "Use this run to compare classic Google visibility against AI-assisted answer surfaces."
      ];
    }
  },
  answer_engine_seo: {
    key: "answer_engine_seo",
    label: "AI SEO Analysis",
    actorId: "apify/google-search-scraper",
    actorEnvKey: "APIFY_ACTOR_ANSWER_ENGINE_SEO",
    taskEnvKey: "APIFY_TASK_ANSWER_ENGINE_SEO",
    buildInput: (client) => ({
      queries: buildAnswerQueries(client).join("\n"),
      countryCode: "us",
      languageCode: "en",
      resultsPerPage: 10,
      maxPagesPerQuery: 1,
      disableGoogleSearchResults: true,
      aiModeSearch: {
        enableAiMode: true
      },
      perplexitySearch: {
        enablePerplexity: true
      },
      chatGptSearch: {
        enableChatGpt: true
      }
    }),
    buildInputSummary: (client) => [
      `Answer-engine query pack: ${buildAnswerQueries(client).join(" | ")}`,
      `Focus: AI-only result channels where available`,
      `Website seed: ${client.websiteUrl ?? "not set"}`
    ],
    summarize: (client, previewItems) => {
      const mentionCount = countBrandMentions(previewItems, client);

      return [
        `Retrieved ${previewItems.length} AI-focused preview rows.`,
        mentionCount
          ? `The brand or domain appeared in ${mentionCount} of those preview rows.`
          : "The preview did not show a direct brand/domain match in the AI-focused rows.",
        "This is the quickest way to pressure-test whether answer engines are surfacing the client."
      ];
    }
  },
  site_crawl: {
    key: "site_crawl",
    label: "Site Crawl",
    actorId: "apify/website-content-crawler",
    actorEnvKey: "APIFY_ACTOR_SITE_CRAWL",
    taskEnvKey: "APIFY_TASK_SITE_CRAWL",
    buildInput: (client) => {
      if (!client.websiteUrl) {
        throw new Error("Client website URL is required before running the Apify site crawl.");
      }

      return {
        startUrls: [{ url: client.websiteUrl }],
        maxCrawlPages: 25,
        crawlerType: "playwright:adaptive"
      };
    },
    buildInputSummary: (client) => [
      `Start URL: ${client.websiteUrl ?? "missing"}`,
      "Crawl depth: 25 pages max",
      "Output: site content footprint preview"
    ],
    summarize: (_client, previewItems) => {
      const urls = extractUrls(previewItems);

      return [
        `Retrieved ${previewItems.length} crawled page preview rows.`,
        urls.length ? `Preview URLs: ${urls.slice(0, 3).join(" | ")}` : "The preview rows did not expose page URLs cleanly.",
        "Use this run to spot thin site coverage before content or AI-search work."
      ];
    }
  },
  local_listings: {
    key: "local_listings",
    label: "Local SEO Data",
    actorId: "scrapers/google-maps",
    actorEnvKey: "APIFY_ACTOR_LOCAL_LISTINGS",
    taskEnvKey: "APIFY_TASK_LOCAL_LISTINGS",
    buildInput: (client) => ({
      searchStringsArray: [client.name],
      locationQuery: client.primaryLocationLabel ?? "United States",
      maxCrawledPlacesPerSearch: 10,
      scrapeContacts: true,
      scrapePlaceDetailPage: true
    }),
    buildInputSummary: (client) => [
      `Search string: ${client.name}`,
      `Location query: ${client.primaryLocationLabel ?? "United States"}`,
      "Output: listing rows with contacts and detail-page fields when available"
    ],
    summarize: (client, previewItems) => [
      `Retrieved ${previewItems.length} local listing preview rows for ${client.name}.`,
      `Location seed used: ${client.primaryLocationLabel ?? "United States"}.`,
      "This run is useful for fast local-pack sanity checks and listing-detail inspection."
    ]
  }
};

function resolveApifySource(definition: ApifyActionDefinition): { sourceType: "actor" | "task"; sourceId: string } {
  const taskId = process.env[definition.taskEnvKey]?.trim();
  if (taskId) {
    return { sourceType: "task", sourceId: taskId };
  }

  const actorId = process.env[definition.actorEnvKey]?.trim() || definition.actorId;
  return { sourceType: "actor", sourceId: actorId };
}

function getApifyTokens(): ApifyTokenEntry[] {
  const primary = process.env.APIFY_TOKEN?.trim();
  const fallbacks = (process.env.APIFY_FALLBACK_TOKENS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const tokens = [primary, ...fallbacks].filter((value): value is string => Boolean(value));
  const uniqueTokens = [...new Set(tokens)];

  return uniqueTokens.map((token, index) => ({ token, index }));
}

function shouldTryNextApifyToken(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const record = error as { statusCode?: number; type?: string; message?: string };
  const statusCode = record.statusCode;
  if (typeof statusCode === "number" && [401, 402, 403, 408, 409, 429, 500, 502, 503, 504].includes(statusCode)) {
    return true;
  }

  const haystack = `${record.type ?? ""} ${record.message ?? ""}`.toLowerCase();
  return [
    "rate limit",
    "rate-limit",
    "quota",
    "credit",
    "payment",
    "unauthorized",
    "forbidden",
    "invalid token",
    "token",
    "too many requests",
    "timed out",
    "timeout",
    "temporarily unavailable"
  ].some((fragment) => haystack.includes(fragment));
}

async function runApifyWithFallbacks<T>(callback: (clientApi: ApifyClient) => Promise<T>): Promise<{ result: T; tokenIndex: number }> {
  const tokens = getApifyTokens();
  if (!tokens.length) {
    throw new Error("APIFY_TOKEN is not configured.");
  }

  let lastError: unknown = null;
  for (const entry of tokens) {
    try {
      const result = await callback(new ApifyClient({ token: entry.token }));
      return { result, tokenIndex: entry.index };
    } catch (error) {
      lastError = error;
      if (!shouldTryNextApifyToken(error) || entry.index === tokens.length - 1) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Apify token rotation failed.");
}

function mapApifyRunRow(row: Record<string, unknown>): ApifyRunRecord {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    clientId: String(row.client_id),
    actionKey: String(row.action_key) as ApifyActionKey,
    label: typeof row.label === "string" ? row.label : "Apify Run",
    status: String(row.status) as ApifyRunRecord["status"],
    sourceType: String(row.source_type) as ApifyRunRecord["sourceType"],
    sourceId: String(row.source_id),
    apifyRunId: typeof row.apify_run_id === "string" ? row.apify_run_id : null,
    datasetId: typeof row.dataset_id === "string" ? row.dataset_id : null,
    inputSummary: Array.isArray(row.input_summary) ? row.input_summary.map(String) : [],
    summaryLines: Array.isArray(row.summary_lines) ? row.summary_lines.map(String) : [],
    previewItems: Array.isArray(row.preview_items)
      ? row.preview_items.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
      : [],
    error: typeof row.error === "string" ? row.error : null,
    createdBy: typeof row.created_by === "string" ? row.created_by : "system",
    createdAt: String(row.created_at),
    finishedAt: typeof row.finished_at === "string" ? row.finished_at : null,
    updatedAt: String(row.updated_at ?? row.created_at)
  };
}

function getInMemoryApifyRuns(): ApifyRunRecord[] {
  if (!globalApifyStore.__aiblitzApifyRuns) {
    globalApifyStore.__aiblitzApifyRuns = [];
  }

  return globalApifyStore.__aiblitzApifyRuns;
}

export async function listApifyRunsForClient(clientId: string, organizationId: string): Promise<ApifyRunRecord[]> {
  if (!isSupabaseConfigured()) {
    return getInMemoryApifyRuns()
      .filter((run) => run.clientId === clientId && run.organizationId === organizationId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("apify_runs")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    throw new Error(`Failed to load Apify runs: ${error.message}`);
  }

  return (data ?? []).map((row) => mapApifyRunRow(row as Record<string, unknown>));
}

async function persistApifyRun(run: ApifyRunRecord): Promise<ApifyRunRecord> {
  if (!isSupabaseConfigured()) {
    const runs = getInMemoryApifyRuns();
    const remaining = runs.filter((existing) => existing.id !== run.id);
    globalApifyStore.__aiblitzApifyRuns = [run, ...remaining];
    return run;
  }

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("apify_runs")
    .insert({
      id: run.id,
      organization_id: run.organizationId,
      client_id: run.clientId,
      action_key: run.actionKey,
      label: run.label,
      status: run.status,
      source_type: run.sourceType,
      source_id: run.sourceId,
      apify_run_id: run.apifyRunId,
      dataset_id: run.datasetId,
      input_summary: run.inputSummary,
      summary_lines: run.summaryLines,
      preview_items: run.previewItems,
      error: run.error,
      created_by: run.createdBy,
      created_at: run.createdAt,
      finished_at: run.finishedAt,
      updated_at: run.updatedAt
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Failed to store Apify run: ${error?.message ?? "unknown error"}`);
  }

  return mapApifyRunRow(data as Record<string, unknown>);
}

export async function runApifyAction(options: {
  actionKey: ApifyActionKey;
  client: ApifyWorkspaceClient;
  createdBy: string;
}): Promise<ApifyRunRecord> {
  const definition = apifyDefinitions[options.actionKey];
  const source = resolveApifySource(definition);
  const createdAt = new Date().toISOString();

  try {
    const input = definition.buildInput(options.client);
    const { result, tokenIndex } = await runApifyWithFallbacks(async (clientApi) => {
      const run =
        source.sourceType === "task"
          ? await clientApi.task(source.sourceId).call(input, { waitSecs: 180 })
          : await clientApi.actor(source.sourceId).call(input, { waitSecs: 180 });

      const datasetId = typeof run.defaultDatasetId === "string" ? run.defaultDatasetId : null;
      const datasetPayload = datasetId ? await clientApi.dataset(datasetId).listItems({ limit: 5 }) : { items: [] };

      return {
        run,
        datasetPayload,
        datasetId
      };
    });

    const { run, datasetPayload, datasetId } = result;
    const previewItems = sanitizePreviewItems(datasetPayload.items ?? []);
    const summaryLines = definition.summarize(options.client, previewItems);
    if (tokenIndex > 0) {
      summaryLines.unshift(`Apify token fallback used: pool index ${tokenIndex + 1}.`);
    }

    const record: ApifyRunRecord = {
      id: randomUUID(),
      organizationId: options.client.organizationId,
      clientId: options.client.id,
      actionKey: definition.key,
      label: definition.label,
      status: run.status === "SUCCEEDED" ? "succeeded" : "failed",
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      apifyRunId: typeof run.id === "string" ? run.id : null,
      datasetId,
      inputSummary: definition.buildInputSummary(options.client),
      summaryLines,
      previewItems,
      error: run.status === "SUCCEEDED" ? null : `Apify run finished with status ${run.status}.`,
      createdBy: options.createdBy,
      createdAt,
      finishedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    return persistApifyRun(record);
  } catch (error) {
    const failedRecord: ApifyRunRecord = {
      id: randomUUID(),
      organizationId: options.client.organizationId,
      clientId: options.client.id,
      actionKey: definition.key,
      label: definition.label,
      status: "failed",
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      apifyRunId: null,
      datasetId: null,
      inputSummary: definition.buildInputSummary(options.client),
      summaryLines: [],
      previewItems: [],
      error: error instanceof Error ? error.message : String(error),
      createdBy: options.createdBy,
      createdAt,
      finishedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    return persistApifyRun(failedRecord);
  }
}
