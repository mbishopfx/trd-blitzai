import type { BlitzAction, BlitzRun } from "@trd-aiblitz/domain";
import { GbpApiClient, refreshAccessToken, type GbpAttributeMetadata } from "@trd-aiblitz/integrations-gbp";
import QRCode from "qrcode";
import sharp from "sharp";
import { decryptJsonToken, encryptJsonToken } from "../crypto";
import { getSupabaseServiceClient, isSupabaseConfigured } from "../supabase";
import type {
  ActionExecutionResult,
  ActionExecutor,
  BlitzRunRepository,
  ClientMediaAssetRecord,
  ClientOrchestrationSettingsRecord,
  IntegrationConnectionRecord
} from "../types";

interface TokenPayload {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

interface ResolvedLocation {
  accountName: string;
  accountId: string;
  locationName: string;
  locationId: string;
  title: string | null;
  websiteUri: string | null;
}

interface RunContext {
  connection: IntegrationConnectionRecord;
  token: TokenPayload;
  client: GbpApiClient;
  locations: ResolvedLocation[];
  warnings: string[];
  settings: ClientOrchestrationSettingsRecord;
  mediaAssets: ClientMediaAssetRecord[];
}

interface LandingPageContext {
  pageTitle: string | null;
  metaDescription: string | null;
  h1: string | null;
  firstParagraph: string | null;
}

interface TinyUrlResult {
  tinyUrl: string;
  originalUrl: string;
  success: boolean;
  error?: string;
}

interface GeneratedPostCopy {
  title: string;
  longForm: string;
  snippet: string;
  provider: "gemini" | "template";
  model: string | null;
  warning?: string;
}

interface TrendSignalBundle {
  localTrendSignals: string[];
  localQuestionIntents: string[];
  searchIntentSignals: string[];
  competitorCitationSignals: string[];
}

interface BurstArchetypePlan {
  archetype: "offer" | "event" | "proof" | "did_you_know";
  label: string;
}

interface ContentLocationBundle {
  location: ResolvedLocation;
  snapshot: LocationRichSnapshot;
  competitors: CompetitorRecord[];
  suggestions: LocationSemanticSuggestions;
  signalBundle: TrendSignalBundle;
}

interface CompetitorRecord {
  name: string;
  formattedAddress: string | null;
  rating: number | null;
  userRatingCount: number | null;
  primaryType: string | null;
  types: string[];
  websiteUri: string | null;
  distanceMiles?: number | null;
  relevanceScore?: number;
  rankPosition?: number;
}

interface SemanticServiceBundle {
  serviceName: string;
  serviceDescription: string;
}

interface LocationSemanticSuggestions {
  profileDescription: string | null;
  primaryCategory: string | null;
  serviceBundles: SemanticServiceBundle[];
  qaPairs: Array<{ question: string; answer: string }>;
  usps: string[];
  suggestedCategories: string[];
  suggestedServices: string[];
  suggestedProducts: string[];
  suggestedAttributes: string[];
  hoursRecommendations: string[];
  warning?: string;
  model?: string | null;
  promptVersion?: string;
}

interface GeoPoint {
  lat: number;
  lng: number;
}

interface LocationRichSnapshot {
  locationName: string;
  title: string | null;
  websiteUri: string | null;
  profileDescription: string | null;
  categories: string[];
  categoryResourceNames: string[];
  serviceLabels: string[];
  attributes: string[];
  regularHours: Record<string, unknown> | null;
  specialHours: Record<string, unknown> | null;
  storefrontAddress: Record<string, unknown> | null;
  formattedAddress: string | null;
  geo: GeoPoint | null;
  reviewCount: number;
  averageRating: number;
  postCount30d: number;
}

interface VisionAssetMetadata {
  caption: string;
  altText: string;
  tags: string[];
  entities: string[];
  sceneType: string;
  qualityScore: number;
  isSafe: boolean;
  isRelevant: boolean;
  moderationRisk: "low" | "medium" | "high";
  serviceRelevanceScore: number;
  rejectionReasons?: string[];
  warning?: string;
  model?: string | null;
}

interface MediaFloodUploadCandidate {
  sourceAssetId: string | null;
  sourceType: "client_bucket" | "external_url";
  variantType: "action_shot" | "team_photo" | "story_vertical" | "virtual_tour_360" | "video_story" | "video_original";
  mediaFormat: "PHOTO" | "VIDEO";
  mimeType: string;
  mediaUrl: string;
  naturalFileName: string;
  caption: string;
  altText: string;
  tags: string[];
  locationCategory: string;
  geoTag: {
    cityState: string | null;
    lat: number | null;
    lng: number | null;
  };
  storagePath?: string | null;
}

interface ExecutorOptions {
  maxPostBurst: number;
  maxReviewRepliesPerAction: number;
}

const DEFAULT_OPTIONS: ExecutorOptions = {
  maxPostBurst: 25,
  maxReviewRepliesPerAction: 60
};

const HARDCODED_POSTS_PER_DAY = 2;
const HARDCODED_POST_DAYS_PER_WEEK = 3;
const HARDCODED_POSTS_PER_WEEK = HARDCODED_POSTS_PER_DAY * HARDCODED_POST_DAYS_PER_WEEK;
const HARDCODED_WEEKLY_POST_WINDOWS = [
  "+1d@14:30",
  "+1d@19:00",
  "+3d@14:30",
  "+3d@19:00",
  "+5d@14:30",
  "+5d@19:00"
] as const;

const BLITZ_COMPLETENESS_PROMPT_VERSION = "blitzforge-completeness-v1";
const DEFAULT_SEMANTIC_MODEL = "gemini-2.0-flash";
const BANNED_MARKETING_WORDS = [
  "best",
  "premier",
  "high-quality",
  "highest quality",
  "world-class",
  "top-rated",
  "number one",
  "unmatched",
  "leading"
];

function nowIso(): string {
  return new Date().toISOString();
}

function toDateParts(date: Date): { year: string; month: string; day: string } {
  return {
    year: String(date.getUTCFullYear()),
    month: String(date.getUTCMonth() + 1),
    day: String(date.getUTCDate())
  };
}

function toNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(String).map((entry) => entry.trim()).filter(Boolean);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function parseAccountId(accountName: string): string {
  return accountName.replace(/^accounts\//, "");
}

function parseLocationId(locationName: string): string {
  return locationName.replace(/^locations\//, "");
}

function parseReviewId(reviewName: string, fallback?: string): string {
  const match = reviewName.match(/reviews\/([^/]+)$/);
  return match?.[1] ?? fallback ?? reviewName;
}

function parseLocalPostReference(postName: string): { accountId: string; locationId: string; localPostId: string } | null {
  const match = postName.match(/accounts\/([^/]+)\/locations\/([^/]+)\/localPosts\/([^/]+)$/);
  if (!match) {
    return null;
  }
  return {
    accountId: match[1],
    locationId: match[2],
    localPostId: match[3]
  };
}

function parseStarRating(value: unknown): number {
  if (typeof value === "number") {
    return Math.max(0, Math.min(5, Math.floor(value)));
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return Math.max(0, Math.min(5, Math.floor(numeric)));
    }

    const enumMap: Record<string, number> = {
      FIVE: 5,
      FOUR: 4,
      THREE: 3,
      TWO: 2,
      ONE: 1
    };
    return enumMap[value.toUpperCase()] ?? 0;
  }
  return 0;
}

function wordCount(value: string): number {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function truncateToMaxWords(value: string, maxWords: number): string {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) {
    return value.trim();
  }
  const trimmed = words.slice(0, maxWords).join(" ").trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function readableObjective(objective: string): string {
  return objective
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function extractSitemapLocEntries(xml: string): string[] {
  const matches = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)];
  return matches
    .map((match) => decodeXmlEntities(match[1] ?? "").trim())
    .filter((entry) => entry.startsWith("http://") || entry.startsWith("https://"));
}

function extractRssItemTitles(xml: string): string[] {
  const matches = [...xml.matchAll(/<item\b[\s\S]*?<title>\s*([^<]+?)\s*<\/title>[\s\S]*?<\/item>/gi)];
  return matches.map((match) => normalizeText(decodeXmlEntities(match[1] ?? ""))).filter(Boolean);
}

function likelyNestedSitemap(url: string): boolean {
  const normalized = url.toLowerCase();
  return normalized.endsWith(".xml") || normalized.includes("sitemap");
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateChars(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return value.slice(0, Math.max(0, maxChars)).trim();
}

function stripBannedMarketingClaims(value: string): string {
  let result = value;
  for (const banned of BANNED_MARKETING_WORDS) {
    const pattern = new RegExp(`\\b${banned.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    result = result.replace(pattern, "");
  }
  return normalizeText(result.replace(/\s{2,}/g, " "));
}

function sanitizeDeclarativeCopy(value: string, maxChars: number): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  const withoutFluff = stripBannedMarketingClaims(normalized);
  const compact = truncateChars(withoutFluff, maxChars).trim();
  if (!compact) {
    return "";
  }
  return /[.!?]$/.test(compact) ? compact : `${compact}.`;
}

function sanitizeEntityLabel(value: string, maxChars: number): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  return truncateChars(stripBannedMarketingClaims(normalized), maxChars);
}

function extractNeighborhoodHintFromAddress(formattedAddress: string): string | null {
  const clean = normalizeText(formattedAddress);
  if (!clean) {
    return null;
  }
  const firstSegment = clean.split(",")[0]?.trim() ?? "";
  if (!firstSegment || /\d/.test(firstSegment)) {
    return null;
  }
  return firstSegment;
}

function inferCountyFromAddress(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const match = value.match(/([A-Za-z][A-Za-z ]+ County)/i);
  if (!match?.[1]) {
    return null;
  }
  return normalizeText(match[1]);
}

function stripHtmlTags(value: string): string {
  return normalizeText(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );
}

function extractHtmlTagContent(html: string, tagName: string): string | null {
  const match = html.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  if (!match?.[1]) {
    return null;
  }
  return stripHtmlTags(match[1]).slice(0, 220) || null;
}

function extractMetaDescription(html: string): string | null {
  const match =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["'][^>]*>/i);
  if (!match?.[1]) {
    return null;
  }
  return normalizeText(decodeXmlEntities(match[1])).slice(0, 260) || null;
}

function toSentenceCase(value: string): string {
  if (!value) {
    return value;
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function summarizeUrlPath(urlString: string): string {
  try {
    const url = new URL(urlString);
    const path = url.pathname.replace(/^\/+|\/+$/g, "");
    if (!path) {
      return "homepage offers";
    }
    const tokens = path
      .split("/")
      .flatMap((segment) => segment.split("-"))
      .map((token) => token.trim())
      .filter(Boolean)
      .slice(0, 6);
    if (!tokens.length) {
      return "service content";
    }
    return `${tokens.join(" ")} information`;
  } catch {
    return "service information";
  }
}

function uniqueStrings(values: Array<string | null | undefined>, limit?: number): string[] {
  const seen = new Set<string>();
  const results: string[] = [];
  for (const raw of values) {
    const value = typeof raw === "string" ? normalizeText(raw) : "";
    if (!value) {
      continue;
    }
    const key = value.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    results.push(value);
    if (limit && results.length >= limit) {
      break;
    }
  }
  return results;
}

function keywordTokens(values: string[]): string[] {
  return uniqueStrings(
    values.flatMap((value) =>
      normalizeText(value)
        .toLowerCase()
        .split(/[^a-z0-9]+/g)
        .map((token) => token.trim())
        .filter((token) => token.length >= 4)
    )
  );
}

function buildHardcodedWeeklyPostWindows(): string[] {
  return [...HARDCODED_WEEKLY_POST_WINDOWS];
}

function parseRelativeWindow(baseDate: Date, window: string, jitterSeed: string): string {
  const normalized = window.trim();
  const dayWithTime = normalized.match(/^\+(\d+)d@(\d{1,2}):(\d{2})$/i);
  if (dayWithTime) {
    const dayOffset = Number(dayWithTime[1]);
    const hour = clamp(Number(dayWithTime[2]), 0, 23);
    const minute = clamp(Number(dayWithTime[3]), 0, 59);
    const scheduledAt = new Date(baseDate);
    scheduledAt.setUTCDate(scheduledAt.getUTCDate() + dayOffset);
    scheduledAt.setUTCHours(hour, minute, 0, 0);
    return scheduledAt.toISOString();
  }

  const match = normalized.match(/^\+(\d+)([dh])$/i);
  const scheduledAt = new Date(baseDate);
  if (!match) {
    return scheduledAt.toISOString();
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === "d") {
    scheduledAt.setUTCDate(scheduledAt.getUTCDate() + amount);
  } else {
    scheduledAt.setUTCHours(scheduledAt.getUTCHours() + amount);
  }

  const jitterMinutes = hashStringToNumber(`${window}:${jitterSeed}`) % 180;
  scheduledAt.setUTCMinutes(scheduledAt.getUTCMinutes() + jitterMinutes);
  return scheduledAt.toISOString();
}

function buildDefaultGeoDripWindows(input: {
  count: number;
  minGapDays: number;
  maxGapDays: number;
  seed: string;
}): string[] {
  const count = clamp(Math.round(input.count), 1, 30);
  const minGap = clamp(Math.round(input.minGapDays), 1, 30);
  const maxGap = clamp(Math.max(minGap, Math.round(input.maxGapDays)), minGap, 30);
  const span = Math.max(1, maxGap - minGap + 1);

  let dayCursor = minGap;
  const windows: string[] = [];
  for (let index = 0; index < count; index += 1) {
    if (index > 0) {
      const jitter = hashStringToNumber(`${input.seed}:${index}`) % span;
      dayCursor += minGap + jitter;
    }
    windows.push(`+${dayCursor}d`);
  }
  return windows;
}

function buildPostFingerprint(input: {
  title: string;
  snippet: string;
  longForm: string;
  landingUrl: string;
  archetype: string;
}): string {
  const normalize = (value: string, maxLength: number): string =>
    normalizeText(value)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxLength);

  const landingPath = (() => {
    try {
      const parsed = new URL(input.landingUrl);
      return `${parsed.host}${parsed.pathname}`.toLowerCase();
    } catch {
      return normalize(input.landingUrl, 120);
    }
  })();

  return [
    normalize(input.title, 140),
    normalize(input.snippet, 320),
    normalize(input.longForm, 900),
    landingPath,
    normalize(input.archetype, 40)
  ].join("|");
}

function uniquePostTitle(title: string, suffix: string): string {
  const cleanTitle = normalizeText(title) || "Local Update";
  const cleanSuffix = normalizeText(suffix) || "Fresh Angle";
  const maxBase = Math.max(20, 110 - cleanSuffix.length - 3);
  return `${cleanTitle.slice(0, maxBase)} | ${cleanSuffix}`.slice(0, 110);
}

function buildBurstArchetypePlan(index: number, configured: string[]): BurstArchetypePlan {
  const supported: BurstArchetypePlan["archetype"][] = ["offer", "event", "proof", "did_you_know"];
  const normalized = configured
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is BurstArchetypePlan["archetype"] => supported.includes(value as BurstArchetypePlan["archetype"]));
  const archetypes = normalized.length ? normalized : supported;
  const archetype = archetypes[index % archetypes.length];
  const labels: Record<BurstArchetypePlan["archetype"], string> = {
    offer: "Offer",
    event: "Event",
    proof: "Proof",
    did_you_know: "Did You Know"
  };
  return {
    archetype,
    label: labels[archetype]
  };
}

function mergeQaPairs(
  primary: Array<{ question: string; answer: string }>,
  fallback: Array<{ question: string; answer: string }>,
  limit: number
): Array<{ question: string; answer: string }> {
  const seen = new Set<string>();
  const merged: Array<{ question: string; answer: string }> = [];
  for (const entry of [...primary, ...fallback]) {
    const question = normalizeText(entry.question);
    const answer = normalizeText(entry.answer);
    if (!question || !answer) {
      continue;
    }
    const key = question.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push({ question, answer });
    if (merged.length >= limit) {
      break;
    }
  }
  return merged;
}

function normalizeQuestionText(value: string): string {
  const normalized = normalizeText(value).replace(/[.?!]+$/g, "");
  if (!normalized) {
    return "";
  }
  return `${normalized}?`;
}

function isQuestionLike(value: string): boolean {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return false;
  }
  if (normalized.includes("?")) {
    return true;
  }
  return /^(how|what|when|where|why|who|can|do|does|is|are|should|could|will|which|whats|how much|how long)\b/.test(
    normalized
  );
}

function hasTechnicalSignal(value: string): boolean {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return false;
  }
  if (/\b\d+(\.\d+)?\b/.test(normalized)) {
    return true;
  }
  if (/\b(hour|hours|day|days|year|years|psi|gpm|kw|volt|amp|warranty|inspection|diagnostic|licensed|dispatch)\b/.test(normalized)) {
    return true;
  }
  if (/\b(rheem|navien|ao smith|a\.o\. smith|bradford white|carrier|trane|mitsubishi)\b/.test(normalized)) {
    return true;
  }
  return false;
}

function answerIncludesLocalEntity(answer: string, localEntities: string[]): boolean {
  const normalized = normalizeText(answer).toLowerCase();
  if (!normalized) {
    return false;
  }
  return localEntities.some((entity) => {
    const token = normalizeText(entity).toLowerCase();
    return token.length >= 3 && normalized.includes(token);
  });
}

function enforceGeoQaAnswerRules(input: {
  answer: string;
  maxWords: number;
  localEntities: string[];
  fallbackLocalEntity: string | null;
  fallbackTechnicalDetail: string | null;
}): string {
  let result = sanitizeDeclarativeCopy(input.answer, 360);
  if (!result) {
    result = "Details are provided after a scope review and service compatibility check.";
  }

  if (!answerIncludesLocalEntity(result, input.localEntities) && input.fallbackLocalEntity) {
    result = sanitizeDeclarativeCopy(`${result} Service area includes ${input.fallbackLocalEntity}.`, 360);
  }

  if (!hasTechnicalSignal(result) && input.fallbackTechnicalDetail) {
    result = sanitizeDeclarativeCopy(`${result} ${input.fallbackTechnicalDetail}`, 360);
  }

  if (wordCount(result) > input.maxWords) {
    result = truncateToMaxWords(result, input.maxWords);
  }
  return result;
}

function isLikelyQuestionIntent(value: string): boolean {
  if (!value) {
    return false;
  }
  return /(\?)|^(how|what|when|where|why|who|can|do|does|is|are|should|could|will)\b/i.test(value.trim());
}

function sanitizeStorageSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function normalizeHttpUrl(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  try {
    const normalized = new URL(value.trim());
    if (normalized.protocol !== "http:" && normalized.protocol !== "https:") {
      return null;
    }
    return normalized.toString();
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function extensionFromMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("jpeg") || normalized.includes("jpg")) {
    return "jpg";
  }
  if (normalized.includes("png")) {
    return "png";
  }
  if (normalized.includes("webp")) {
    return "webp";
  }
  if (normalized.includes("gif")) {
    return "gif";
  }
  if (normalized.includes("mp4")) {
    return "mp4";
  }
  if (normalized.includes("quicktime") || normalized.includes("mov")) {
    return "mov";
  }
  if (normalized.includes("webm")) {
    return "webm";
  }
  return "bin";
}

function inferMediaMimeType(input: { fileName?: string | null; mimeType?: string | null; url?: string | null }): string {
  const explicit = input.mimeType?.trim().toLowerCase();
  if (explicit) {
    return explicit;
  }
  const probe = `${input.fileName ?? ""} ${input.url ?? ""}`.toLowerCase();
  if (/\.(jpg|jpeg)(\?|$)/.test(probe)) {
    return "image/jpeg";
  }
  if (/\.(png)(\?|$)/.test(probe)) {
    return "image/png";
  }
  if (/\.(webp)(\?|$)/.test(probe)) {
    return "image/webp";
  }
  if (/\.(gif)(\?|$)/.test(probe)) {
    return "image/gif";
  }
  if (/\.(mp4)(\?|$)/.test(probe)) {
    return "video/mp4";
  }
  if (/\.(mov)(\?|$)/.test(probe)) {
    return "video/quicktime";
  }
  if (/\.(webm)(\?|$)/.test(probe)) {
    return "video/webm";
  }
  return "application/octet-stream";
}

function isVideoMimeType(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith("video/");
}

function isImageMimeType(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith("image/");
}

function hashStringToNumber(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function buildFingerprint(input: {
  clientId: string;
  locationName: string;
  objective: string;
  payload: Record<string, unknown>;
}): string {
  const payloadJson = JSON.stringify(input.payload);
  const raw = `${input.clientId}|${input.locationName}|${input.objective}|${payloadJson}`;
  return `${hashStringToNumber(raw)}`;
}

function parseJsonObjectFromText(value: string): Record<string, unknown> | null {
  const attempts = [
    value.trim(),
    value
      .replace(/^```json/i, "")
      .replace(/^```/i, "")
      .replace(/```$/i, "")
      .trim()
  ].filter(Boolean);

  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Continue trying fallback extraction paths.
    }
  }

  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const subset = value.slice(start, end + 1);
    try {
      const parsed = JSON.parse(subset);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }

  return null;
}

function normalizeBusinessName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function categoryLabel(value: unknown): string | null {
  if (typeof value === "string") {
    const normalized = normalizeText(value);
    return normalized || null;
  }
  const record = asRecord(value);
  const candidates = [
    typeof record.displayName === "string" ? record.displayName : null,
    typeof record.name === "string" ? record.name : null
  ].filter((entry): entry is string => Boolean(entry));
  return candidates[0] ? normalizeText(candidates[0]) : null;
}

function normalizeCategoryResourceName(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith("categories/")) {
    return trimmed;
  }
  if (/\s/.test(trimmed)) {
    return null;
  }
  if (trimmed.includes("/")) {
    return null;
  }
  if (/^gcid:[a-z0-9_]+$/i.test(trimmed) || /^[0-9]{4,}$/.test(trimmed)) {
    return `categories/${trimmed}`;
  }
  return null;
}

function addressFromStorefront(storefront: Record<string, unknown> | null): string | null {
  if (!storefront) {
    return null;
  }

  const addressLines = Array.isArray(storefront.addressLines)
    ? storefront.addressLines.map(String).map((line) => line.trim()).filter(Boolean)
    : [];
  if (addressLines.length) {
    return addressLines.join(", ");
  }

  const parts = [
    typeof storefront.locality === "string" ? storefront.locality : null,
    typeof storefront.administrativeArea === "string" ? storefront.administrativeArea : null,
    typeof storefront.postalCode === "string" ? storefront.postalCode : null
  ].filter((entry): entry is string => Boolean(entry));
  if (parts.length) {
    return parts.join(", ");
  }

  return null;
}

function formatCityState(storefront: Record<string, unknown> | null): string | null {
  if (!storefront) {
    return null;
  }
  const locality = typeof storefront.locality === "string" ? storefront.locality.trim() : "";
  const state = typeof storefront.administrativeArea === "string" ? storefront.administrativeArea.trim() : "";
  if (locality && state) {
    return `${locality}, ${state}`;
  }
  return locality || state || null;
}

function haversineMiles(a: GeoPoint, b: GeoPoint): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadiusMiles = 3959;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const inner =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(inner), Math.sqrt(1 - inner));
  return earthRadiusMiles * c;
}

function safeAverage(values: number[]): number {
  if (!values.length) {
    return 0;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function normalizeRating(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(5, value));
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.min(5, parsed));
    }
  }
  return 0;
}

function mediaUrlFromAsset(asset: ClientMediaAssetRecord): string | null {
  const metadata = asRecord(asset.metadata);
  const candidates = [
    typeof metadata.signedUrl === "string" ? metadata.signedUrl : null,
    typeof metadata.publicUrl === "string" ? metadata.publicUrl : null,
    typeof metadata.sourceUrl === "string" ? metadata.sourceUrl : null,
    typeof metadata.url === "string" ? metadata.url : null
  ].filter((value): value is string => Boolean(value));
  return candidates[0] ?? null;
}

function cleanDisplayText(value: string, fallback: string): string {
  const normalized = normalizeText(value)
    .replace(/\bhttps?:\/\/\S+/gi, " ")
    .replace(/\b[a-z0-9.-]+\.(com|net|org|io|co|biz|info)\b/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return normalized || fallback;
}

function extractCityFromSignals(signals: string[]): string | null {
  for (const signal of signals) {
    const normalized = normalizeText(signal);
    const match = normalized.match(/\b([A-Za-z][A-Za-z\s]+,\s?[A-Z]{2})\b/);
    if (match?.[1]) {
      return cleanDisplayText(match[1], "").slice(0, 60) || null;
    }
  }
  return null;
}

function buildStyledGbpSnippet(input: {
  locationTitle: string;
  topicLabel: string;
  shortUrl: string;
  ctaUrl?: string | null;
  localTrendSignals: string[];
  addressLine?: string | null;
}): string {
  const locationTitle = cleanDisplayText(input.locationTitle, "Our team").slice(0, 90);
  const topicLabel = cleanDisplayText(input.topicLabel, "Furniture Repair and Refinishing").slice(0, 110);
  const cityState = extractCityFromSignals(input.localTrendSignals);
  const ctaTarget = input.ctaUrl ?? input.shortUrl;
  const areaLine = cityState ? `${topicLabel} in ${cityState}` : topicLabel;
  const hashtags = cityState && cityState.toLowerCase().includes("new york")
    ? "#FurnitureRefinishing #NYCRefinishing #FurnitureRepair #CustomRepairs"
    : "#FurnitureRefinishing #FurnitureRepair #CustomRepairs #WoodRestoration";

  const lines = [
    `🔧 ${areaLine}? ${locationTitle} is here to help.`,
    "",
    `At ${locationTitle}, we bring worn or damaged furniture back to life with hands-on repair and refinishing craftsmanship.`,
    "",
    "💰 Cost-effective restoration that helps you avoid full replacement costs.",
    "🏆 Skilled craftsmanship for repairs, touch-ups, veneer work, and finish correction.",
    "🛋️ Personalized service based on your style, piece condition, and timeline.",
    "✅ Durable finish protection designed for daily use in real homes and businesses.",
    "",
    "Let’s restore your furniture the right way. Reach out today and see the difference quality refinishing can make.",
    "",
    hashtags,
    "",
    "Click here to learn more:",
    ctaTarget
  ];

  if (input.addressLine) {
    lines.push("", `📍 ${cleanDisplayText(input.addressLine, "").slice(0, 120)}`);
  }

  return lines.join("\n").slice(0, 1450);
}

function buildEeatLongFormPost(input: {
  locationTitle: string;
  objective: string;
  ordinal: number;
  archetype: BurstArchetypePlan;
  tone: string;
  wordRange: { min: number; max: number };
  landingUrl: string;
  shortUrl: string;
  pageContext: LandingPageContext;
  localTrendSignals: string[];
  localQuestionIntents: string[];
  searchIntentSignals: string[];
  competitorCitationSignals: string[];
  qaPair?: { question: string; answer: string } | null;
  ctaUrl?: string | null;
}): { title: string; longForm: string; snippet: string } {
  const targetMin = clamp(input.wordRange.min, 120, 2000);
  const targetMax = clamp(Math.max(targetMin, input.wordRange.max), targetMin, 2000);
  const targetWords = clamp(Math.round((targetMin + targetMax) / 2), targetMin, targetMax);
  const objectiveLabel = readableObjective(input.objective);
  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const topicLabel =
    input.pageContext.h1 ??
    input.pageContext.pageTitle ??
    toSentenceCase(summarizeUrlPath(input.landingUrl));
  const metaBlurb =
    input.pageContext.metaDescription ??
    input.pageContext.firstParagraph ??
      `${input.locationTitle} updated this page to answer high-intent local buyer questions with clearer scope, proof, and CTA guidance.`;
  const ctaTarget = input.ctaUrl ?? input.shortUrl;
  const trendLine = input.localTrendSignals.length
    ? input.localTrendSignals.slice(0, 3).join("; ")
    : "seasonal local demand and conversion-ready service intent";
  const searchIntentLine = input.searchIntentSignals.length
    ? input.searchIntentSignals.slice(0, 4).join("; ")
    : "service availability, local proof, fast response, and clear next steps";
  const questionIntentLine = input.localQuestionIntents.length
    ? input.localQuestionIntents.slice(0, 3).join("; ")
    : "common local buyer questions and urgency patterns";
  const competitorCitationLine = input.competitorCitationSignals.length
    ? input.competitorCitationSignals.slice(0, 3).join(" | ")
    : "nearby competitors are active, so factual differentiation matters";
  const qaPromptLine = input.qaPair
    ? `Common GBP question addressed: ${input.qaPair.question} Answer: ${input.qaPair.answer}`
    : "Common GBP questions are being documented for manual seeding.";
  const title = `${input.archetype.label}: ${topicLabel}`.slice(0, 120);

  const requiredSections = [
    `# Local Service Brief (${today})`,
    "## Experience",
    `${input.locationTitle} completed this week's ${objectiveLabel} cycle and aligned this ${input.archetype.label.toLowerCase()} post to the live page topic: "${topicLabel}". This update uses a ${input.tone} tone so local buyers can quickly evaluate fit, timelines, and practical outcomes before contacting the team.`,
    "## Expertise",
    `The team standardized delivery checkpoints for discovery, planning, execution, and handoff. Each checkpoint includes operating detail, expected turnaround, quality controls, and escalation rules so service quality stays consistent even as request volume changes. Core page focus: ${metaBlurb}`,
    "## Authoritativeness",
    `This location benchmarked active local competitors, category intent, and profile visibility factors. Published facts focus on verifiable service details, clear scope boundaries, and location relevance so search systems can classify the business accurately for high-intent queries. Competitor citation signals: ${competitorCitationLine}.`,
    "## Trust",
    `Claims in this post are tied to real operations, documented customer interactions, and current availability. Messaging avoids inflated promises and keeps language specific enough for users to validate through direct contact, review history, and current profile metadata. Traffic path tracked via ${ctaTarget}.`,
    "## Structured Snippet",
    `- Content Archetype: ${input.archetype.label}\n- Trend Signals: ${trendLine}\n- Search Intent: ${searchIntentLine}\n- Local Question Intents: ${questionIntentLine}\n- Reputation Signals: review response workflow active with escalation guardrails`,
    "## GBP Q&A Alignment",
    qaPromptLine,
    "## Action Summary",
    `This is entry #${input.ordinal} in the current Blitz content sequence. The post captures EEAT-aligned proof points, practical delivery detail, and next-step guidance for local search users evaluating providers right now.`
  ];

  const supplementalParagraphs = [
    `${input.locationTitle} also documented common pre-service questions so potential customers can compare options before requesting work. This includes expected prep steps, required customer inputs, and realistic completion windows tied to service type.`,
    `Internal QA now logs completion standards for every published service update, including factual accuracy checks, local relevance checks, and final compliance review before content is pushed live. This protects consistency across profile, website, and ad messaging.`,
    `Customer communication standards were refreshed to include clearer status updates during active jobs, faster follow-up after delivery, and transparent escalation paths when service issues appear. These operating changes are designed to improve trust and repeat engagement signals.`,
    `The profile content strategy now emphasizes concise, intent-matched language that maps directly to service outcomes customers care about: turnaround speed, scope clarity, and reliability. That keeps the listing useful for both users and AI-driven local discovery systems.`,
    `Performance tracking remains active across calls, direction requests, profile clicks, and review patterns. The team uses these signals to tune the next publishing cycle and keep future updates grounded in what local users are actually doing.`,
    `Media and post cadence controls are synchronized with policy limits so activity remains natural and sustainable over time. This prevents inconsistent burst behavior while still maintaining freshness signals that influence local visibility.`,
    `Operational details, service constraints, and fulfillment windows are reviewed weekly to ensure published information stays current. If delivery constraints change, the content plan is updated immediately to avoid stale or misleading statements.`
  ];

  let longForm = requiredSections.join("\n\n");
  let paragraphIndex = 0;
  while (wordCount(longForm) < targetWords) {
    const paragraph = supplementalParagraphs[paragraphIndex % supplementalParagraphs.length];
    longForm = `${longForm}\n\n${paragraph}`;
    paragraphIndex += 1;
  }

  if (wordCount(longForm) > targetMax) {
    longForm = truncateToMaxWords(longForm, targetMax);
  }

  if (input.ctaUrl) {
    longForm = `${longForm}\n\n## Next Step\nRead more or request service: ${input.ctaUrl}`;
    if (wordCount(longForm) > targetMax) {
      longForm = truncateToMaxWords(longForm, targetMax);
    }
  }

  const snippet = buildStyledGbpSnippet({
    locationTitle: input.locationTitle,
    topicLabel,
    shortUrl: input.shortUrl,
    ctaUrl: ctaTarget,
    localTrendSignals: input.localTrendSignals
  });

  return {
    title,
    longForm,
    snippet
  };
}

function replyForReview(input: {
  reviewerName: string;
  starRating: number;
  comment: string;
  locationTitle: string;
  tone: string;
  style: string;
  serviceName?: string | null;
  cityName?: string | null;
}): string {
  const inferServiceEntity = (comment: string): string | null => {
    const normalized = normalizeText(comment).toLowerCase();
    if (!normalized) {
      return null;
    }
    const serviceLexicon = [
      "tankless water heater",
      "water heater",
      "sump pump",
      "drain cleaning",
      "pipe repair",
      "roof repair",
      "hvac repair",
      "ac repair",
      "furnace repair",
      "electrical panel",
      "window replacement",
      "bathroom remodel",
      "kitchen remodel"
    ];
    const hit = serviceLexicon.find((token) => normalized.includes(token));
    return hit ? hit : null;
  };

  const inferLocality = (locationTitle: string): string => {
    const compact = normalizeText(locationTitle);
    if (!compact) {
      return "your area";
    }
    const chunks = compact.split(/[|,-]/).map((entry) => entry.trim()).filter(Boolean);
    return chunks.length >= 2 ? chunks[chunks.length - 1] : compact;
  };

  const name = input.reviewerName.trim() || "there";
  const locality = sanitizeEntityLabel(input.cityName ?? inferLocality(input.locationTitle), 80) || "your area";
  const serviceEntity =
    sanitizeEntityLabel(input.serviceName ?? inferServiceEntity(input.comment) ?? "your recent service", 90) ||
    "your recent service";
  const intro = `Hi ${name}, thank you for your feedback.`;
  const tonePrefix = input.tone.includes("friendly") ? "We appreciate you choosing our team." : "";
  if (input.starRating >= 4) {
    return `${intro} ${tonePrefix} Our team in ${locality} is glad we could help with ${serviceEntity}. If you need follow-up support, tap Call and we will prioritize your request.`
      .replace(/\s+/g, " ")
      .trim();
  }
  if (input.starRating === 3) {
    return `${intro} ${tonePrefix} We appreciate your input about ${serviceEntity} in ${locality}. We are already using this feedback to improve response speed and communication on future jobs.`
      .replace(/\s+/g, " ")
      .trim();
  }
  const directEnding = input.style.toLowerCase().includes("direct")
    ? "Please call us today so a manager can fix this immediately."
    : "Please contact us directly so we can make this right.";
  return `${intro} We're sorry your ${serviceEntity} experience in ${locality} did not meet expectations. ${directEnding}`
    .replace(/\s+/g, " ")
    .trim();
}

function buildPostSummary(input: {
  locationTitle: string;
  objective: string;
  ordinal: number;
  payload: Record<string, unknown>;
}): string {
  const explicit = typeof input.payload.summaryTemplate === "string" ? input.payload.summaryTemplate.trim() : "";
  if (explicit) {
    return explicit.slice(0, 1500);
  }

  const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const prefix = input.objective === "geo_content_burst" ? "Local Update" : "Business Update";
  return `${prefix}: ${input.locationTitle} is actively serving local customers. Reach out today for fast support and availability (${today}, #${input.ordinal}).`.slice(
    0,
    1500
  );
}

export class GbpLiveActionExecutor implements ActionExecutor {
  private readonly contextCache = new Map<string, RunContext>();
  private readonly websiteGroundTruthCache = new Map<string, { rawTextDump: string; sourceUrls: string[] }>();
  private readonly localQuestionIntentCache = new Map<string, string[]>();
  private readonly options: ExecutorOptions;

  constructor(
    private readonly deps: {
      repository: BlitzRunRepository;
    },
    options?: Partial<ExecutorOptions>
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async execute(input: { run: BlitzRun; action: BlitzAction }): Promise<ActionExecutionResult> {
    const context = await this.loadRunContext(input.run, input.action);
    const objective = typeof input.action.payload.objective === "string" ? input.action.payload.objective : "unknown";

    switch (input.action.actionType) {
      case "profile_patch":
        return {
          output: await this.executeProfilePatch({ action: input.action, context, objective })
        };
      case "attribute_update":
        return {
          output: await this.executeAttributeUpdate({ action: input.action, context })
        };
      case "media_upload":
        return {
          output: await this.executeMediaUpload({ action: input.action, context })
        };
      case "post_publish":
        return {
          output: await this.executePostPublish({ action: input.action, context, objective })
        };
      case "review_reply":
        return {
          output: await this.executeReviewReplies({ action: input.action, context })
        };
      case "hours_update":
        return {
          output: await this.executeHoursUpdate({ action: input.action, context })
        };
      default:
        throw new Error(`Unsupported action type: ${input.action.actionType}`);
    }
  }

  async rollback(input: { run: BlitzRun; action: BlitzAction }): Promise<{ output: Record<string, unknown> }> {
    const context = await this.loadRunContext(input.run, input.action);

    if (input.action.actionType !== "post_publish") {
      return {
        output: {
          status: "rollback_not_supported",
          actionType: input.action.actionType
        }
      };
    }

    const publishedPosts = Array.isArray(input.action.result?.publishedPosts)
      ? (input.action.result?.publishedPosts as Array<Record<string, unknown>>)
      : [];

    const deleted: Array<Record<string, unknown>> = [];
    const failed: Array<Record<string, unknown>> = [];

    for (const entry of publishedPosts) {
      const postName = typeof entry.name === "string" ? entry.name : "";
      const parsed = parseLocalPostReference(postName);
      if (!parsed) {
        failed.push({
          name: postName || "unknown",
          error: "invalid post name format"
        });
        continue;
      }

      try {
        await context.client.deleteLocalPost(parsed.accountId, parsed.locationId, parsed.localPostId);
        deleted.push({
          name: postName,
          accountId: parsed.accountId,
          locationId: parsed.locationId
        });
      } catch (error) {
        failed.push({
          name: postName,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return {
      output: {
        status: failed.length ? "partial" : "ok",
        deletedPosts: deleted,
        failedPosts: failed
      }
    };
  }

  private async loadRunContext(run: BlitzRun, action: BlitzAction): Promise<RunContext> {
    const cached = this.contextCache.get(run.id);
    if (cached && !this.isTokenExpiring(cached.token, 900)) {
      return cached;
    }

    const connection = await this.deps.repository.getActiveIntegrationConnection(run.clientId, "gbp");
    if (!connection) {
      throw new Error(
        `No active GBP integration found for client ${run.clientId}. Connect GBP OAuth before starting a live run.`
      );
    }

    const token = await this.ensureFreshToken(connection);
    const client = new GbpApiClient(token.accessToken);
    const resolved = await this.resolveLocations(connection, client, action.payload);

    if (!resolved.locations.length) {
      throw new Error("No GBP locations found for the connected account scope.");
    }

    const settings = await this.deps.repository.getClientOrchestrationSettings(run.clientId);
    const mediaAssets = await this.deps.repository.listClientMediaAssets(run.clientId);

    const context: RunContext = {
      connection,
      token,
      client,
      locations: resolved.locations,
      warnings: resolved.warnings,
      settings,
      mediaAssets
    };

    this.contextCache.set(run.id, context);
    return context;
  }

  private async ensureFreshToken(connection: IntegrationConnectionRecord): Promise<TokenPayload> {
    const tokenBlob = connection.encryptedTokenPayload.token;
    if (typeof tokenBlob !== "string" || !tokenBlob.length) {
      throw new Error("GBP integration token payload is missing encrypted token blob.");
    }

    const decrypted = decryptJsonToken(tokenBlob);
    const accessToken = typeof decrypted.accessToken === "string" ? decrypted.accessToken : "";
    const refreshToken = typeof decrypted.refreshToken === "string" ? decrypted.refreshToken : "";
    const expiresAt = typeof decrypted.expiresAt === "string" ? decrypted.expiresAt : null;

    if (!accessToken) {
      throw new Error("GBP integration token payload is missing access token.");
    }

    const hasExpiry = typeof expiresAt === "string" && !Number.isNaN(new Date(expiresAt).getTime());
    const expiringSoon = hasExpiry ? this.isTokenExpiring({ accessToken, refreshToken, expiresAt }, 120) : false;
    if (!expiringSoon) {
      return {
        accessToken,
        refreshToken,
        expiresAt: hasExpiry ? expiresAt : new Date(Date.now() + 45 * 60 * 1000).toISOString()
      };
    }

    if (!refreshToken) {
      throw new Error("GBP access token is expiring and refresh token is not available.");
    }

    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
    const redirectUri =
      process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() ??
      process.env.NEXT_PUBLIC_SITE_URL?.trim()?.concat("/api/v1/gbp/oauth/callback") ??
      "https://localhost/api/v1/gbp/oauth/callback";
    if (!clientId || !clientSecret) {
      throw new Error("Google OAuth env missing. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET.");
    }

    const refreshed = await refreshAccessToken(
      {
        clientId,
        clientSecret,
        redirectUri
      },
      refreshToken
    );

    const nextToken: TokenPayload = {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      expiresAt: refreshed.expiresAt
    };

    await this.deps.repository.updateIntegrationConnection(connection.id, {
      encryptedTokenPayload: {
        ...connection.encryptedTokenPayload,
        token: encryptJsonToken({
          accessToken: nextToken.accessToken,
          refreshToken: nextToken.refreshToken,
          expiresAt: nextToken.expiresAt
        })
      },
      scopes: refreshed.scopes.length ? refreshed.scopes : connection.scopes,
      tokenExpiresAt: refreshed.expiresAt,
      lastRefreshAt: nowIso()
    });

    return nextToken;
  }

  private async resolveLocations(
    connection: IntegrationConnectionRecord,
    client: GbpApiClient,
    actionPayload: Record<string, unknown>
  ): Promise<{ locations: ResolvedLocation[]; warnings: string[] }> {
    const warnings: string[] = [];
    const accounts = await client.listAccounts();

    if (!accounts.length) {
      throw new Error("Connected GBP user has no accessible accounts.");
    }

    const accountNames = accounts.map((account) => account.name).filter(Boolean);
    const metadata = asRecord(connection.metadata);
    const payloadRequestedAccount = typeof actionPayload.accountName === "string" ? actionPayload.accountName : null;

    const candidates = [
      payloadRequestedAccount,
      connection.providerAccountId.startsWith("accounts/") ? connection.providerAccountId : null,
      typeof metadata.accountName === "string" ? metadata.accountName : null
    ].filter((value): value is string => Boolean(value));

    let scopedAccounts = [...new Set(candidates)].filter((candidate) => accountNames.includes(candidate));
    if (!scopedAccounts.length) {
      if (accounts.length === 1) {
        scopedAccounts = [accounts[0].name];
      } else {
        scopedAccounts = [accounts[0].name];
        warnings.push(
          `No explicit account scope configured; defaulted to ${accounts[0].name}. Configure providerAccountId/accountName for strict targeting.`
        );
      }
    }

    const locations: ResolvedLocation[] = [];
    for (const accountName of scopedAccounts) {
      const accountId = parseAccountId(accountName);
      const locationRows = await client.listLocations(accountName);
      for (const row of locationRows) {
        if (!row.name) {
          continue;
        }
        locations.push({
          accountName,
          accountId,
          locationName: row.name,
          locationId: parseLocationId(row.name),
          title: row.title ?? null,
          websiteUri: row.websiteUri ?? null
        });
      }
    }

    const payloadLocationNames = toStringArray(actionPayload.locationNames);
    const metadataLocationNames = [
      ...(typeof metadata.locationName === "string" ? [metadata.locationName] : []),
      ...toStringArray(metadata.locationNames)
    ];
    const filteredLocations =
      payloadLocationNames.length > 0
        ? locations.filter((location) => payloadLocationNames.includes(location.locationName))
        : metadataLocationNames.length > 0
          ? locations.filter((location) => metadataLocationNames.includes(location.locationName))
          : locations;

    return {
      locations: filteredLocations,
      warnings
    };
  }

  private async fetchTextWithTimeout(url: string, timeoutMs = 15000): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: "text/html,application/xml;q=0.9,text/xml;q=0.9,*/*;q=0.5"
        }
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }
      return await response.text();
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchBufferWithTimeout(url: string, timeoutMs = 15000): Promise<Buffer> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }
      return Buffer.from(await response.arrayBuffer());
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchBinaryWithTimeout(
    url: string,
    timeoutMs = 15000
  ): Promise<{ buffer: Buffer; contentType: string | null }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }
      const contentTypeRaw = response.headers.get("content-type");
      const contentType = contentTypeRaw ? contentTypeRaw.split(";")[0]?.trim().toLowerCase() ?? null : null;
      return {
        buffer: Buffer.from(await response.arrayBuffer()),
        contentType
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private async loadSitemapUrls(sitemapUrl: string | null): Promise<string[]> {
    const normalizedSitemapUrl = normalizeHttpUrl(sitemapUrl);
    if (!normalizedSitemapUrl) {
      return [];
    }

    const visited = new Set<string>();
    const primaryHost = new URL(normalizedSitemapUrl).host;

    const walk = async (url: string, depth: number): Promise<string[]> => {
      if (depth > 2 || visited.has(url)) {
        return [];
      }
      visited.add(url);

      let xml: string;
      try {
        xml = await this.fetchTextWithTimeout(url, 15000);
      } catch {
        return [];
      }

      const entries = extractSitemapLocEntries(xml);
      if (!entries.length) {
        return [];
      }

      const nested = entries.filter(likelyNestedSitemap).slice(0, 12);
      const pages = entries.filter((entry) => !likelyNestedSitemap(entry));
      if (!nested.length || depth >= 2) {
        return pages;
      }

      const nestedPages = (
        await Promise.all(nested.map(async (nestedUrl) => walk(nestedUrl, depth + 1)))
      ).flat();

      return [...pages, ...nestedPages];
    };

    const rawUrls = await walk(normalizedSitemapUrl, 0);
    const filtered = [...new Set(rawUrls)]
      .map((entry) => normalizeHttpUrl(entry))
      .filter((entry): entry is string => Boolean(entry))
      .filter((entry) => {
        try {
          const parsed = new URL(entry);
          if (parsed.host !== primaryHost) {
            return false;
          }
          const lowerPath = `${parsed.pathname}${parsed.search}`.toLowerCase();
          if (
            lowerPath.includes("/tag/") ||
            lowerPath.includes("/author/") ||
            lowerPath.includes("/feed") ||
            lowerPath.includes("/wp-json") ||
            lowerPath.includes("/category/")
          ) {
            return false;
          }
          return true;
        } catch {
          return false;
        }
      });

    return filtered;
  }

  private selectLandingUrl(input: {
    action: BlitzAction;
    context: RunContext;
    location: ResolvedLocation;
    index: number;
    sitemapUrls: string[];
  }): { landingUrl: string; source: "payload" | "sitemap" | "default" } {
    const payloadLandingUrl = normalizeHttpUrl(
      typeof input.action.payload.landingUrl === "string" ? input.action.payload.landingUrl : null
    );
    if (payloadLandingUrl) {
      return {
        landingUrl: payloadLandingUrl,
        source: "payload"
      };
    }

    if (input.sitemapUrls.length > 0) {
      const seed = hashStringToNumber(`${input.action.id}:${input.location.locationId}:${input.index}`);
      const selected = input.sitemapUrls[seed % input.sitemapUrls.length];
      return {
        landingUrl: selected,
        source: "sitemap"
      };
    }

    const fallback =
      normalizeHttpUrl(input.context.settings.defaultPostUrl) ??
      normalizeHttpUrl(input.location.websiteUri);
    if (!fallback) {
      throw new Error("No valid landing URL found. Configure sitemapUrl or defaultPostUrl for this client.");
    }
    return {
      landingUrl: fallback,
      source: "default"
    };
  }

  private async fetchLandingPageContext(url: string): Promise<LandingPageContext> {
    try {
      const html = await this.fetchTextWithTimeout(url, 12000);
      const paragraphMatch = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
      return {
        pageTitle: extractHtmlTagContent(html, "title"),
        metaDescription: extractMetaDescription(html),
        h1: extractHtmlTagContent(html, "h1"),
        firstParagraph: paragraphMatch?.[1] ? stripHtmlTags(paragraphMatch[1]).slice(0, 320) : null
      };
    } catch {
      return {
        pageTitle: null,
        metaDescription: null,
        h1: null,
        firstParagraph: null
      };
    }
  }

  private async createTinyUrl(url: string): Promise<TinyUrlResult> {
    const normalized = normalizeHttpUrl(url);
    if (!normalized) {
      return {
        tinyUrl: url,
        originalUrl: url,
        success: false,
        error: "Invalid URL for TinyURL"
      };
    }

    const apiKey = process.env.TINYURL_API_KEY?.trim();
    if (!apiKey) {
      return {
        tinyUrl: normalized,
        originalUrl: normalized,
        success: false,
        error: "TINYURL_API_KEY not configured"
      };
    }

    try {
      const response = await fetch("https://api.tinyurl.com/create", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          url: normalized
        })
      });

      if (!response.ok) {
        return {
          tinyUrl: normalized,
          originalUrl: normalized,
          success: false,
          error: `TinyURL API returned ${response.status}`
        };
      }

      const payload = (await response.json()) as { data?: { tiny_url?: string } };
      const tinyUrl = normalizeHttpUrl(payload.data?.tiny_url ?? null);
      if (!tinyUrl) {
        return {
          tinyUrl: normalized,
          originalUrl: normalized,
          success: false,
          error: "TinyURL response missing tiny_url"
        };
      }

      return {
        tinyUrl,
        originalUrl: normalized,
        success: true
      };
    } catch (error) {
      return {
        tinyUrl: normalized,
        originalUrl: normalized,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async resolveDirectAssetMediaUrl(asset: ClientMediaAssetRecord): Promise<string | null> {
    const existing = normalizeHttpUrl(mediaUrlFromAsset(asset));
    if (existing) {
      return existing;
    }

    if (!isSupabaseConfigured()) {
      return null;
    }

    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase.storage.from(asset.storageBucket).createSignedUrl(asset.storagePath, 60 * 60 * 24 * 7);
    if (error || !data?.signedUrl) {
      return null;
    }
    return normalizeHttpUrl(data.signedUrl);
  }

  private async downloadAssetBuffer(asset: ClientMediaAssetRecord): Promise<Buffer> {
    if (isSupabaseConfigured()) {
      const supabase = getSupabaseServiceClient();
      const { data, error } = await supabase.storage.from(asset.storageBucket).download(asset.storagePath);
      if (!error && data) {
        return Buffer.from(await data.arrayBuffer());
      }
    }

    const directUrl = await this.resolveDirectAssetMediaUrl(asset);
    if (!directUrl) {
      throw new Error(`Unable to resolve downloadable URL for media asset ${asset.id}`);
    }
    return this.fetchBufferWithTimeout(directUrl, 15000);
  }

  private async generateQrOverlayMedia(input: {
    asset: ClientMediaAssetRecord;
    clientId: string;
    actionId: string;
    qrUrl: string;
  }): Promise<{ mediaUrl: string | null; processedStoragePath: string | null; error: string | null }> {
    const fallbackMediaUrl = await this.resolveDirectAssetMediaUrl(input.asset);
    if (!isSupabaseConfigured()) {
      return {
        mediaUrl: fallbackMediaUrl,
        processedStoragePath: null,
        error: "Supabase is not configured for QR media generation"
      };
    }

    const supabase = getSupabaseServiceClient();

    try {
      const sourceBuffer = await this.downloadAssetBuffer(input.asset);
      const image = sharp(sourceBuffer, { failOn: "none" });
      const metadata = await image.metadata();
      const width = metadata.width ?? 0;
      const height = metadata.height ?? 0;
      if (width < 100 || height < 100) {
        throw new Error("Source image dimensions are too small for QR overlay");
      }

      const qrSize = Math.floor(clamp(Math.min(width, height) * 0.16, 100, 420));
      const padding = Math.floor(clamp(Math.min(width, height) * 0.025, 10, 40));
      const qrBuffer = await QRCode.toBuffer(input.qrUrl, {
        width: qrSize,
        margin: 1,
        color: {
          dark: "#000000",
          light: "#FFFFFF"
        }
      });

      const backgroundSize = qrSize + padding * 2;
      const qrWithBackground = await sharp({
        create: {
          width: backgroundSize,
          height: backgroundSize,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 0.9 }
        }
      })
        .composite([
          {
            input: qrBuffer,
            left: padding,
            top: padding
          }
        ])
        .png()
        .toBuffer();

      const left = Math.max(0, width - backgroundSize - padding);
      const top = Math.max(0, height - backgroundSize - padding);

      const outputBuffer = await image
        .png()
        .composite([
          {
            input: qrWithBackground,
            left,
            top
          }
        ])
        .png()
        .toBuffer();

      const dateFolder = new Date().toISOString().slice(0, 10);
      const outputPath = `processed/${dateFolder}/${sanitizeStorageSegment(input.clientId)}-${sanitizeStorageSegment(input.actionId)}-${sanitizeStorageSegment(input.asset.id)}-${Date.now()}.png`;

      const { error: uploadError } = await supabase.storage.from(input.asset.storageBucket).upload(outputPath, outputBuffer, {
        contentType: "image/png",
        cacheControl: "3600",
        upsert: false
      });
      if (uploadError) {
        throw new Error(uploadError.message);
      }

      const { data: signedData, error: signedError } = await supabase.storage
        .from(input.asset.storageBucket)
        .createSignedUrl(outputPath, 60 * 60 * 24 * 7);
      if (signedError || !signedData?.signedUrl) {
        throw new Error(signedError?.message ?? "Unable to create signed URL for processed image");
      }

      return {
        mediaUrl: normalizeHttpUrl(signedData.signedUrl),
        processedStoragePath: outputPath,
        error: null
      };
    } catch (error) {
      return {
        mediaUrl: fallbackMediaUrl,
        processedStoragePath: null,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private buildGeminiPrompt(input: {
    locationTitle: string;
    objective: string;
    archetype: BurstArchetypePlan;
    tone: string;
    wordRange: { min: number; max: number };
    landingUrl: string;
    shortUrl: string;
    pageContext: LandingPageContext;
    objectives: string[];
    localTrendSignals: string[];
    localQuestionIntents: string[];
    searchIntentSignals: string[];
    competitorCitationSignals: string[];
    qaPair?: { question: string; answer: string } | null;
    systemMessage?: string | null;
  }): string {
    const pageTitle = input.pageContext.pageTitle ?? "N/A";
    const pageH1 = input.pageContext.h1 ?? "N/A";
    const metaDescription = input.pageContext.metaDescription ?? "N/A";
    const firstParagraph = input.pageContext.firstParagraph ?? "N/A";
    const businessObjectives = input.objectives.length ? input.objectives.join("; ") : "Increase local visibility and conversions";
    const trendLine = input.localTrendSignals.length ? input.localTrendSignals.join("; ") : "seasonal local demand";
    const questionIntentLine = input.localQuestionIntents.length
      ? input.localQuestionIntents.slice(0, 8).join("; ")
      : "local question intents are being monitored";
    const searchIntentLine = input.searchIntentSignals.length ? input.searchIntentSignals.join("; ") : "local service intent";
    const competitorLine = input.competitorCitationSignals.length
      ? input.competitorCitationSignals.join(" | ")
      : "No competitor citation signals available";
    const qaPromptLine = input.qaPair
      ? `${input.qaPair.question} => ${input.qaPair.answer}`
      : "No explicit Q&A pair selected";
    const operatorSystemMessage =
      typeof input.systemMessage === "string" && input.systemMessage.trim()
        ? input.systemMessage.trim()
        : null;

    return [
      "You are a senior local SEO content writer producing GBP post copy.",
      "Write natural, humanized copy with no robotic filler and no hype.",
      "Write for generative local search systems that reward short factual chunks, clear entities, and direct answers.",
      "",
      "Return STRICT JSON only with this exact shape:",
      "{",
      '  "title": "string",',
      '  "longForm": "string",',
      '  "snippet": "string"',
      "}",
      "",
      "Rules:",
      `- longForm must be between ${input.wordRange.min} and ${input.wordRange.max} words.`,
      "- title must be <= 110 characters and read like a publishable GBP headline.",
      "- snippet must be <= 1450 characters and ready to publish as GBP post summary.",
      "- Format longForm using readable markdown sections and short paragraphs.",
      "- Start longForm with a clear H1-style heading relevant to local urgency or local opportunity.",
      "- Include exactly one compact bullet list with 3 factual bullets.",
      "- Include one compact bullet list under a section named Structured Snippet.",
      "- The snippet must read like a complete social post, not a data dump.",
      "- Use short, human-readable sections and benefit bullets in snippet output.",
      "- Never output raw scraped fragments, semicolon-separated token dumps, or malformed domain text.",
      "- Keep tone professional, local-expert, and conversational.",
      "- Anchor the post semantically to the landing page topic and user intent.",
      `- Treat this as a ${input.archetype.label.toLowerCase()} style GBP post.`,
      "- Include a clear conversion CTA with the short URL.",
      "- Limited symbols/emojis are allowed for readability (max 1 per line).",
      "",
      "Context:",
      `- Business: ${input.locationTitle}`,
      `- Objective: ${input.objective}`,
      `- Archetype: ${input.archetype.label}`,
      `- Tone: ${input.tone}`,
      `- Landing URL: ${input.landingUrl}`,
      `- Short URL: ${input.shortUrl}`,
      `- Page title: ${pageTitle}`,
      `- Page H1: ${pageH1}`,
      `- Meta description: ${metaDescription}`,
      `- First paragraph: ${firstParagraph}`,
      `- Business objectives: ${businessObjectives}`,
      `- Local trend signals: ${trendLine}`,
      `- Local question intents: ${questionIntentLine}`,
      `- Search intent signals: ${searchIntentLine}`,
      `- Competitor citation signals: ${competitorLine}`,
      `- GBP Q&A seed angle: ${qaPromptLine}`,
      operatorSystemMessage ? `- Operator system message: ${operatorSystemMessage}` : null,
      "",
      "Output requirements:",
      "- longForm should read like a polished local service update and align with AI retrieval relevance (EEAT, factual clarity, local intent).",
      "- snippet should be concise, actionable, and optimized for GBP readability with the short URL.",
      "- Make the first 2 to 3 sentences highly quotable by Gemini and local AI summaries.",
      operatorSystemMessage ? "- Treat the operator system message as a strict instruction override when policy-safe." : null,
      "",
      "Now return JSON only."
    ]
      .filter(Boolean)
      .join("\n");
  }

  private async generatePostCopy(input: {
    locationTitle: string;
    objective: string;
    ordinal: number;
    archetype: BurstArchetypePlan;
    tone: string;
    wordRange: { min: number; max: number };
    landingUrl: string;
    shortUrl: string;
    pageContext: LandingPageContext;
    objectives: string[];
    localTrendSignals: string[];
    localQuestionIntents: string[];
    searchIntentSignals: string[];
    competitorCitationSignals: string[];
    qaPair?: { question: string; answer: string } | null;
    ctaUrl?: string | null;
    systemMessage?: string | null;
  }): Promise<GeneratedPostCopy> {
    const fallback = buildEeatLongFormPost({
      locationTitle: input.locationTitle,
      objective: input.objective,
      ordinal: input.ordinal,
      archetype: input.archetype,
      tone: input.tone,
      wordRange: input.wordRange,
      landingUrl: input.landingUrl,
      shortUrl: input.shortUrl,
      pageContext: input.pageContext,
      localTrendSignals: input.localTrendSignals,
      localQuestionIntents: input.localQuestionIntents,
      searchIntentSignals: input.searchIntentSignals,
      competitorCitationSignals: input.competitorCitationSignals,
      qaPair: input.qaPair,
      ctaUrl: input.ctaUrl
    });

    const apiKey =
      process.env.GEMINI_API_KEY?.trim() ??
      process.env.GOOGLE_AI_STUDIO_API_KEY?.trim() ??
      process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ??
      process.env.GOOGLE_API_KEY?.trim() ??
      null;
    const model = process.env.GEMINI_MODEL?.trim() || "gemini-2.0-flash";

    if (!apiKey) {
      return {
        title: fallback.title,
        longForm: fallback.longForm,
        snippet: fallback.snippet,
        provider: "template",
        model: null,
        warning: "Gemini API key is not configured. Falling back to deterministic template output."
      };
    }

    try {
      const prompt = this.buildGeminiPrompt({
        locationTitle: input.locationTitle,
        objective: input.objective,
        archetype: input.archetype,
        tone: input.tone,
        wordRange: input.wordRange,
        landingUrl: input.landingUrl,
        shortUrl: input.shortUrl,
        pageContext: input.pageContext,
        objectives: input.objectives,
        localTrendSignals: input.localTrendSignals,
        localQuestionIntents: input.localQuestionIntents,
        searchIntentSignals: input.searchIntentSignals,
        competitorCitationSignals: input.competitorCitationSignals,
        qaPair: input.qaPair,
        systemMessage: input.systemMessage
      });

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [{ text: prompt }]
              }
            ],
            generationConfig: {
              temperature: 0.7,
              topP: 0.9,
              maxOutputTokens: 2200
            }
          })
        }
      );

      if (!response.ok) {
        const responseText = await response.text().catch(() => "");
        return {
          title: fallback.title,
          longForm: fallback.longForm,
          snippet: fallback.snippet,
          provider: "template",
          model,
          warning: `Gemini API returned ${response.status}: ${responseText.slice(0, 220)}`
        };
      }

      const payload = (await response.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{ text?: string }>;
          };
        }>;
      };

      const rawText = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n").trim() ?? "";
      const parsed = parseJsonObjectFromText(rawText);
      const modelTitle = parsed && typeof parsed.title === "string" ? parsed.title.trim() : "";
      const modelLongForm = parsed && typeof parsed.longForm === "string" ? parsed.longForm.trim() : "";
      if (!modelTitle || !modelLongForm) {
        return {
          title: fallback.title,
          longForm: fallback.longForm,
          snippet: fallback.snippet,
          provider: "template",
          model,
          warning: "Gemini response did not provide valid JSON longForm/snippet."
        };
      }

      let longForm = modelLongForm;
      if (wordCount(longForm) < input.wordRange.min) {
        longForm = fallback.longForm;
      }
      if (wordCount(longForm) > input.wordRange.max) {
        longForm = truncateToMaxWords(longForm, input.wordRange.max);
      }

      const topicLabel =
        input.pageContext.h1 ??
        input.pageContext.pageTitle ??
        toSentenceCase(summarizeUrlPath(input.landingUrl));
      const snippet = buildStyledGbpSnippet({
        locationTitle: input.locationTitle,
        topicLabel,
        shortUrl: input.shortUrl,
        ctaUrl: input.ctaUrl,
        localTrendSignals: input.localTrendSignals
      });

      return {
        title: modelTitle.slice(0, 110),
        longForm,
        snippet,
        provider: "gemini",
        model
      };
    } catch (error) {
      return {
        title: fallback.title,
        longForm: fallback.longForm,
        snippet: fallback.snippet,
        provider: "template",
        model,
        warning: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async requestJsonWithAuth<T>(input: {
    url: string;
    accessToken: string;
    method?: "GET" | "POST" | "PATCH";
    body?: Record<string, unknown>;
    timeoutMs?: number;
  }): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 15000);
    try {
      const response = await fetch(input.url, {
        method: input.method ?? "GET",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          "Content-Type": "application/json"
        },
        body: input.body ? JSON.stringify(input.body) : undefined
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`HTTP ${response.status} ${response.statusText} ${body.slice(0, 280)}`.trim());
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private extractLocationCategories(location: Record<string, unknown>): string[] {
    const rawCategories = Array.isArray(location.categories) ? location.categories : [];
    const labels = rawCategories.map((entry) => categoryLabel(entry)).filter((entry): entry is string => Boolean(entry));
    return [...new Set(labels)];
  }

  private extractLocationCategoryResourceNames(location: Record<string, unknown>): string[] {
    const rawCategories = Array.isArray(location.categories) ? location.categories : [];
    const resourceNames = rawCategories
      .map((entry) => {
        if (typeof entry === "string") {
          return normalizeCategoryResourceName(entry);
        }
        const record = asRecord(entry);
        const fromName = typeof record.name === "string" ? normalizeCategoryResourceName(record.name) : null;
        if (fromName) {
          return fromName;
        }
        const fromCategoryId = typeof record.categoryId === "string" ? normalizeCategoryResourceName(record.categoryId) : null;
        return fromCategoryId;
      })
      .filter((entry): entry is string => Boolean(entry));
    return [...new Set(resourceNames)];
  }

  private extractLocationServiceLabels(location: Record<string, unknown>): string[] {
    const rawServiceItems = Array.isArray(location.serviceItems) ? location.serviceItems : [];
    const labels = rawServiceItems
      .map((entry) => {
        const record = asRecord(entry);
        const freeForm = asRecord(record.freeFormServiceItem);
        const labelRecord = asRecord(freeForm.label);
        const displayFromFreeForm = typeof labelRecord.displayName === "string" ? labelRecord.displayName : null;
        if (displayFromFreeForm) {
          return normalizeText(displayFromFreeForm);
        }

        const structured = asRecord(record.structuredServiceItem);
        const displayFromStructured =
          typeof structured.serviceTypeDisplayName === "string"
            ? structured.serviceTypeDisplayName
            : typeof structured.serviceTypeId === "string"
              ? structured.serviceTypeId
              : null;
        if (displayFromStructured) {
          return normalizeText(displayFromStructured);
        }

        const fallbackLabel = typeof record.displayName === "string" ? record.displayName : null;
        return fallbackLabel ? normalizeText(fallbackLabel) : null;
      })
      .filter((entry): entry is string => Boolean(entry));
    return [...new Set(labels)];
  }

  private extractLocationAttributes(location: Record<string, unknown>): string[] {
    const rawAttributes = Array.isArray(location.attributes) ? location.attributes : [];
    const labels = rawAttributes
      .map((attribute) => {
        const record = asRecord(attribute);
        const displayName = typeof record.displayName === "string" ? record.displayName : null;
        if (displayName) {
          return normalizeText(displayName);
        }
        const name = typeof record.name === "string" ? record.name : null;
        if (name) {
          return normalizeText(name);
        }
        return null;
      })
      .filter((entry): entry is string => Boolean(entry));
    return [...new Set(labels)];
  }

  private extractProfileDescription(location: Record<string, unknown>): string | null {
    const profile = asRecord(location.profile);
    const candidates = [
      typeof profile.description === "string" ? profile.description : null,
      typeof profile.summary === "string" ? profile.summary : null,
      typeof location.description === "string" ? location.description : null
    ].filter((entry): entry is string => Boolean(entry));
    if (!candidates.length) {
      return null;
    }
    return normalizeText(candidates[0]);
  }

  private extractSpecialHours(location: Record<string, unknown>): Record<string, unknown> | null {
    const specialHours = asRecord(location.specialHours);
    return Object.keys(specialHours).length ? specialHours : null;
  }

  private extractLocationGeo(location: Record<string, unknown>): GeoPoint | null {
    const latlng = asRecord(location.latlng);
    const latitude = toNumber(latlng.latitude, Number.NaN);
    const longitude = toNumber(latlng.longitude, Number.NaN);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return { lat: latitude, lng: longitude };
    }

    const metadata = asRecord(location.metadata);
    const lat = toNumber(metadata.lat, Number.NaN);
    const lng = toNumber(metadata.lng, Number.NaN);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }
    return null;
  }

  private async fetchLocationWithExtendedMask(input: {
    accessToken: string;
    locationName: string;
  }): Promise<Record<string, unknown>> {
    const masks = [
      "name,title,storefrontAddress,websiteUri,phoneNumbers,regularHours,specialHours,categories,profile,attributes,serviceItems,serviceAreaBusiness",
      "name,title,storefrontAddress,websiteUri,phoneNumbers,regularHours,specialHours,categories,profile,serviceItems,serviceAreaBusiness",
      "name,title,storefrontAddress,websiteUri,phoneNumbers,regularHours,specialHours,categories,profile,serviceAreaBusiness",
      "name,title,storefrontAddress,websiteUri,phoneNumbers,regularHours,specialHours,profile",
      "name,title,storefrontAddress,websiteUri,phoneNumbers,regularHours,profile",
      "name,title,storefrontAddress,websiteUri,phoneNumbers,regularHours"
    ];

    for (const mask of masks) {
      const endpoint = new URL(`https://mybusinessbusinessinformation.googleapis.com/v1/${input.locationName}`);
      endpoint.searchParams.set("readMask", mask);
      try {
        return await this.requestJsonWithAuth<Record<string, unknown>>({
          url: endpoint.toString(),
          accessToken: input.accessToken
        });
      } catch {
        // Try next compatible readMask.
      }
    }

    return {};
  }

  private async geocodeAddress(address: string): Promise<GeoPoint | null> {
    const apiKey =
      process.env.GOOGLE_PLACES_API_KEY?.trim() ??
      process.env.GOOGLE_MAPS_API_KEY?.trim() ??
      process.env.GOOGLE_API_KEY?.trim() ??
      null;
    if (!apiKey) {
      return null;
    }

    try {
      const endpoint = new URL("https://maps.googleapis.com/maps/api/geocode/json");
      endpoint.searchParams.set("address", address);
      endpoint.searchParams.set("key", apiKey);
      const response = await fetch(endpoint.toString(), {
        headers: {
          Accept: "application/json"
        }
      });
      if (!response.ok) {
        return null;
      }
      const payload = (await response.json()) as {
        status?: string;
        results?: Array<{
          geometry?: {
            location?: {
              lat?: number;
              lng?: number;
            };
          };
        }>;
      };

      if (payload.status !== "OK") {
        return null;
      }
      const point = payload.results?.[0]?.geometry?.location;
      if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
        return null;
      }
      return {
        lat: Number(point.lat),
        lng: Number(point.lng)
      };
    } catch {
      return null;
    }
  }

  private async resolveLocationGeo(snapshot: {
    storefrontAddress: Record<string, unknown> | null;
    geo: GeoPoint | null;
    formattedAddress: string | null;
  }): Promise<GeoPoint | null> {
    if (snapshot.geo) {
      return snapshot.geo;
    }

    const formatted = snapshot.formattedAddress ?? addressFromStorefront(snapshot.storefrontAddress);
    if (!formatted) {
      return null;
    }
    return this.geocodeAddress(formatted);
  }

  private async fetchLocationSnapshot(input: {
    context: RunContext;
    location: ResolvedLocation;
  }): Promise<LocationRichSnapshot> {
    const fallback = await input.context.client.fetchLocation(input.location.locationName).catch(() => null);
    const detail = await this.fetchLocationWithExtendedMask({
      accessToken: input.context.token.accessToken,
      locationName: input.location.locationName
    }).catch(() => ({}));

    const merged = {
      ...(fallback ? asRecord(fallback as unknown) : {}),
      ...detail
    };
    const storefrontAddress = asRecord(merged.storefrontAddress);
    const formattedAddress = addressFromStorefront(storefrontAddress) ?? null;
    const existingGeo = this.extractLocationGeo(merged);
    const resolvedGeo = await this.resolveLocationGeo({
      storefrontAddress,
      geo: existingGeo,
      formattedAddress
    });

    const reviews = await input.context.client
      .fetchReviews(input.location.accountId, input.location.locationId)
      .catch(() => []);
    const posts = await input.context.client
      .listPosts(input.location.accountId, input.location.locationId)
      .catch(() => []);

    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const postCount30d = posts.filter((post) => {
      const timestamp = post.updateTime ?? post.createTime ?? null;
      if (!timestamp) {
        return false;
      }
      const timeMs = new Date(timestamp).getTime();
      return Number.isFinite(timeMs) && timeMs >= thirtyDaysAgo;
    }).length;

    return {
      locationName: input.location.locationName,
      title: (typeof merged.title === "string" ? merged.title : null) ?? input.location.title,
      websiteUri:
        normalizeHttpUrl(typeof merged.websiteUri === "string" ? merged.websiteUri : null) ??
        normalizeHttpUrl(input.location.websiteUri),
      profileDescription: this.extractProfileDescription(merged),
      categories: this.extractLocationCategories(merged),
      categoryResourceNames: this.extractLocationCategoryResourceNames(merged),
      serviceLabels: this.extractLocationServiceLabels(merged),
      attributes: this.extractLocationAttributes(merged),
      regularHours: Object.keys(asRecord(merged.regularHours)).length ? asRecord(merged.regularHours) : null,
      specialHours: this.extractSpecialHours(merged),
      storefrontAddress: Object.keys(storefrontAddress).length ? storefrontAddress : null,
      formattedAddress,
      geo: resolvedGeo,
      reviewCount: reviews.length,
      averageRating: safeAverage(reviews.map((review) => parseStarRating(review.starRating))),
      postCount30d
    };
  }

  private async discoverTopCompetitors(input: {
    snapshot: LocationRichSnapshot;
    location: ResolvedLocation;
    objectives: string[];
    maxResults?: number;
  }): Promise<CompetitorRecord[]> {
    const apiKey =
      process.env.GOOGLE_PLACES_API_KEY?.trim() ??
      process.env.GOOGLE_MAPS_API_KEY?.trim() ??
      process.env.GOOGLE_API_KEY?.trim() ??
      null;
    if (!apiKey) {
      return [];
    }

    const limit = clamp(toNumber(input.maxResults, 5), 3, 10);
    const radiusMeters = 16000;
    const primaryCategory = input.snapshot.categories[0] ?? null;
    const cityState = formatCityState(input.snapshot.storefrontAddress);
    const objectiveHint = input.objectives[0] ? readableObjective(input.objectives[0]) : "local services";
    const query = primaryCategory
      ? `${primaryCategory} near ${cityState ?? input.snapshot.formattedAddress ?? ""}`.trim()
      : `${input.snapshot.title ?? input.location.title ?? "Local business"} ${objectiveHint}`.trim();

    const endpoint = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
    endpoint.searchParams.set("query", query);
    if (input.snapshot.geo) {
      endpoint.searchParams.set("location", `${input.snapshot.geo.lat},${input.snapshot.geo.lng}`);
      endpoint.searchParams.set("radius", String(radiusMeters));
    }
    endpoint.searchParams.set("key", apiKey);

    try {
      const payload = await fetch(endpoint.toString(), {
        headers: {
          Accept: "application/json"
        }
      }).then(async (response) => {
        if (!response.ok) {
          throw new Error(`Places API HTTP ${response.status}`);
        }
        return (await response.json()) as {
          status?: string;
          results?: Array<Record<string, unknown>>;
        };
      });

      if (!(payload.status === "OK" || payload.status === "ZERO_RESULTS")) {
        return [];
      }

      const ownName = normalizeBusinessName(input.snapshot.title ?? input.location.title ?? "");
      const parsedCompetitors: CompetitorRecord[] = [];
      for (const row of payload.results ?? []) {
        const name = typeof row.name === "string" ? normalizeText(row.name) : "";
        if (!name) {
          continue;
        }

        const geometry = asRecord(row.geometry);
        const locationPoint = asRecord(geometry.location);
        const lat = toNumber(locationPoint.lat, Number.NaN);
        const lng = toNumber(locationPoint.lng, Number.NaN);
        const geo = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
        const distanceMiles = input.snapshot.geo && geo ? haversineMiles(input.snapshot.geo, geo) : null;
        const rating = normalizeRating(row.rating);
        const reviewCount = toNumber(row.user_ratings_total, 0);
        const types = toStringArray(row.types);
        const formattedAddress =
          typeof row.formatted_address === "string"
            ? row.formatted_address
            : typeof row.vicinity === "string"
              ? row.vicinity
              : null;

        let relevance = 50;
        relevance += rating * 6;
        relevance += Math.min(20, reviewCount / 12);
        if (distanceMiles !== null) {
          relevance -= Math.min(20, distanceMiles * 1.6);
        }
        if (primaryCategory && types.some((type) => type.toLowerCase().includes(primaryCategory.toLowerCase().split(" ")[0]))) {
          relevance += 8;
        }
        relevance = clamp(Math.round(relevance), 0, 100);

        parsedCompetitors.push({
          name,
          formattedAddress,
          rating: rating || null,
          userRatingCount: reviewCount || null,
          primaryType: types.length ? types[0] ?? null : null,
          types,
          websiteUri: null,
          distanceMiles,
          relevanceScore: relevance
        });
      }

      const competitors = parsedCompetitors
        .filter((entry) => normalizeBusinessName(entry.name) !== ownName)
        .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0))
        .slice(0, limit)
        .map((entry, index) => ({ ...entry, rankPosition: index + 1 }));

      return competitors;
    } catch {
      return [];
    }
  }

  private buildCompletenessSystemPrompt(): string {
    return [
      "SYSTEM ROLE:",
      "You are an elite Local SEO Data Architect in 2026.",
      "Your objective is to process raw business data and generate a strictly formatted JSON payload for the Google Business Profile (GBP) API.",
      "Optimize for Google AI Overviews, Gemini-powered Maps, and zero-click local pack retrieval.",
      "",
      "PERSONA & ALGORITHMIC CONTEXT:",
      "- Prioritize local intent matching, entity density, and factual completeness.",
      "- Write in declarative factual language that can be quoted by retrieval systems.",
      "- Optimize for relevance, distance context, and prominence signals without policy violations.",
      "",
      "ANTI-FLUFF DIRECTIVES:",
      "- No hype language and no unverifiable claims.",
      '- Do not use words such as "best", "premier", "high-quality", "world-class", or "top-rated" unless explicitly quoted from source data.',
      "- Use concise factual chunks and concrete entities (brands, neighborhoods, service types, response windows).",
      "",
      "JSON CONTRACT:",
      "- Return JSON only. No markdown. No prose outside JSON.",
      "- Required keys: profileDescription, primaryCategory, services.",
      "- profileDescription max 750 characters.",
      "- Each serviceDescription max 300 characters."
    ].join("\n");
  }

  private async loadWebsiteGroundTruth(input: {
    websiteUri: string | null;
    sitemapUrls: string[];
  }): Promise<{ rawTextDump: string; sourceUrls: string[] }> {
    const websiteUri = normalizeHttpUrl(input.websiteUri);
    let preferredHost: string | null = null;
    if (websiteUri) {
      try {
        preferredHost = new URL(websiteUri).host;
      } catch {
        preferredHost = null;
      }
    }

    const scopedSitemapUrls = input.sitemapUrls.filter((url) => {
      if (!preferredHost) {
        return true;
      }
      try {
        return new URL(url).host === preferredHost;
      } catch {
        return false;
      }
    });

    const sourceUrls = uniqueStrings([websiteUri, ...scopedSitemapUrls], 3);
    if (!sourceUrls.length) {
      return {
        rawTextDump: "No website content was retrievable for this location.",
        sourceUrls: []
      };
    }

    const cacheKey = sourceUrls.join("|");
    const cached = this.websiteGroundTruthCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const excerpts: string[] = [];
    for (const sourceUrl of sourceUrls) {
      try {
        const html = await this.fetchTextWithTimeout(sourceUrl, 12000);
        const text = truncateChars(stripHtmlTags(html), 2200);
        if (!text) {
          continue;
        }
        excerpts.push(`[${sourceUrl}] ${text}`);
      } catch {
        // Ignore source-level fetch errors and continue.
      }
    }

    const rawTextDump = excerpts.length
      ? truncateChars(excerpts.join("\n\n"), 6500)
      : "No website content was retrievable for this location.";
    const value = {
      rawTextDump,
      sourceUrls
    };
    this.websiteGroundTruthCache.set(cacheKey, value);
    return value;
  }

  private normalizeSemanticServiceBundles(value: unknown, cityState: string): SemanticServiceBundle[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const seen = new Set<string>();
    const results: SemanticServiceBundle[] = [];
    for (const entry of value) {
      const record = asRecord(entry);
      const rawName = typeof record.serviceName === "string" ? record.serviceName : "";
      const rawDescription = typeof record.serviceDescription === "string" ? record.serviceDescription : "";
      const serviceName = sanitizeEntityLabel(rawName, 120);
      if (!serviceName) {
        continue;
      }
      const dedupeKey = serviceName.toLowerCase();
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);

      const fallbackDescription = `${serviceName} is available in ${cityState} with scope, timeline, and pricing details provided before scheduling.`;
      const serviceDescription = sanitizeDeclarativeCopy(rawDescription || fallbackDescription, 300);
      if (!serviceDescription) {
        continue;
      }

      results.push({
        serviceName: truncateChars(serviceName, 120),
        serviceDescription: truncateChars(serviceDescription, 300)
      });
      if (results.length >= 30) {
        break;
      }
    }

    return results;
  }

  private inferTopNeighborhoods(input: {
    cityState: string | null;
    competitors: CompetitorRecord[];
  }): string[] {
    const city = input.cityState?.split(",")[0]?.trim().toLowerCase() ?? "";
    const neighborhoods = uniqueStrings(
      input.competitors
        .map((competitor) => (competitor.formattedAddress ? extractNeighborhoodHintFromAddress(competitor.formattedAddress) : null))
        .filter((value): value is string => Boolean(value))
        .filter((value) => value.toLowerCase() !== city),
      3
    );
    return neighborhoods.length ? neighborhoods : ["not_specified"];
  }

  private buildCompletenessUserPrompt(input: {
    location: ResolvedLocation;
    snapshot: LocationRichSnapshot;
    competitors: CompetitorRecord[];
    objectives: string[];
    rawWebsiteDump: string;
    websiteSources: string[];
  }): string {
    const businessName = input.snapshot.title ?? input.location.title ?? "Business";
    const cityState = formatCityState(input.snapshot.storefrontAddress) ?? "Unknown";
    const county = inferCountyFromAddress(input.snapshot.formattedAddress) ?? "Unknown";
    const neighborhoods = this.inferTopNeighborhoods({
      cityState,
      competitors: input.competitors
    });
    const offerings = uniqueStrings(
      [
        ...input.snapshot.serviceLabels,
        ...input.objectives.map((objective) => readableObjective(objective)),
        ...input.snapshot.categories
      ],
      24
    );
    const competitorLines = input.competitors.length
      ? input.competitors
          .map((competitor, index) => {
            const rating = competitor.rating ? competitor.rating.toFixed(1) : "n/a";
            const reviews = competitor.userRatingCount ?? 0;
            return `${index + 1}. ${competitor.name} | rating=${rating} | reviews=${reviews} | type=${competitor.primaryType ?? "n/a"} | address=${competitor.formattedAddress ?? "n/a"}`;
          })
          .join("\n")
      : "none";
    const sourceLine = input.websiteSources.length ? input.websiteSources.join(", ") : "none";
    const currentCategories = input.snapshot.categories.length ? input.snapshot.categories.join(", ") : "none";
    const currentServices = input.snapshot.serviceLabels.length ? input.snapshot.serviceLabels.join(", ") : "none";

    return [
      "INPUT DATA:",
      `Business Name: ${businessName}`,
      `Location Data: ${cityState}, ${county}, ${neighborhoods.join(", ")}`,
      `Scraped Website Content Sources: ${sourceLine}`,
      `Scraped Website Content: ${input.rawWebsiteDump}`,
      `Core Offerings: ${offerings.length ? offerings.join(", ") : "none provided"}`,
      `Current GBP Categories: ${currentCategories}`,
      `Current GBP Services: ${currentServices}`,
      "",
      "DIRECTIVES & WRITING RULES:",
      "1. High Entity Density: Include specific nouns such as service types, equipment brands, neighborhoods, and outcomes.",
      "2. Declarative Tone: No marketing fluff. No unsupported claims.",
      "3. Granular Services: Break broad offerings into specific bookable services. Max 300 characters per serviceDescription.",
      "4. Completeness: Infer practical GBP field recommendations from industry context while staying policy-safe.",
      "5. Competitor Context: Use competitor patterns for coverage gaps only; do not copy competitor claims.",
      "",
      "TOP COMPETITOR BENCHMARK:",
      competitorLines,
      "",
      "OUTPUT FORMAT:",
      "Return ONLY valid JSON with this schema:",
      "{",
      '  "profileDescription": "string (max 750 characters)",',
      '  "primaryCategory": "string (Google category resource like categories/<id> when possible, else category label)",',
      '  "services": [',
      "    {",
      '      "serviceName": "string",',
      '      "serviceDescription": "string (max 300 characters)"',
      "    }",
      "  ],",
      '  "qaPairs": [{"question":"string","answer":"string"}],',
      '  "usps": ["string"],',
      '  "suggestedCategories": ["string"],',
      '  "suggestedProducts": ["string"],',
      '  "suggestedAttributes": ["string"],',
      '  "hoursRecommendations": ["string"]',
      "}",
      "",
      "Return JSON only."
    ].join("\n");
  }

  private buildFallbackSemanticSuggestions(input: {
    location: ResolvedLocation;
    snapshot: LocationRichSnapshot;
    objectives: string[];
  }): LocationSemanticSuggestions {
    const locationTitle = input.snapshot.title ?? input.location.title ?? "our business";
    const cityState = formatCityState(input.snapshot.storefrontAddress) ?? "the local area";
    const objectiveLine = input.objectives[0] ? readableObjective(input.objectives[0]) : "local visibility";
    const descriptionSeed = [
      `${locationTitle} serves customers across ${cityState} with clear scope, reliable communication, and outcome-focused service delivery.`,
      `Our team prioritizes ${objectiveLine}, transparent turnaround expectations, and practical recommendations tailored to local demand.`,
      "Contact us for current availability and same-day guidance where applicable."
    ].join(" ");
    const profileDescription = sanitizeDeclarativeCopy(descriptionSeed, 750);
    const serviceNames = uniqueStrings(
      [
        ...input.snapshot.serviceLabels,
        ...input.objectives.map((objective) => `${readableObjective(objective)} service`)
      ],
      24
    );
    const serviceBundles = serviceNames.map((serviceName) => ({
      serviceName: sanitizeEntityLabel(serviceName, 120),
      serviceDescription: truncateChars(
        sanitizeDeclarativeCopy(
          `${serviceName} is available in ${cityState} with clear scope, timeline expectations, and booking guidance for local customers.`,
          300
        ),
        300
      )
    }));
    const qaSeedQuestions = uniqueStrings(
      [
        `What areas does ${locationTitle} serve?`,
        `How quickly can I get started with ${locationTitle}?`,
        `What services does ${locationTitle} provide in ${cityState}?`,
        `Does ${locationTitle} offer same-day or urgent scheduling?`,
        `What should I expect during the first visit with ${locationTitle}?`,
        `How do I know which service is right for my situation?`,
        `Can ${locationTitle} help with recurring or ongoing service needs?`,
        `What information should I have ready before contacting ${locationTitle}?`,
        `Does ${locationTitle} work with residential and commercial customers?`,
        `How does ${locationTitle} handle estimates or consultations?`,
        `What makes ${locationTitle} different from other local providers?`,
        `Does ${locationTitle} offer service options tailored to my neighborhood?`,
        `How does ${locationTitle} keep communication clear during the job?`,
        `Can ${locationTitle} explain timelines before work begins?`,
        `What happens after I submit a request to ${locationTitle}?`,
        `Does ${locationTitle} provide follow-up guidance after service?`,
        `How does ${locationTitle} maintain quality across every appointment?`,
        `Can I contact ${locationTitle} for help choosing the right next step?`,
        `Is ${locationTitle} a good fit for first-time customers in ${cityState}?`,
        `How do customers usually get the fastest response from ${locationTitle}?`
      ],
      24
    );

    return {
      profileDescription,
      primaryCategory: input.snapshot.categoryResourceNames[0] ?? input.snapshot.categories[0] ?? null,
      serviceBundles,
      qaPairs: qaSeedQuestions.map((question, index) => ({
        question,
        answer:
          index % 2 === 0
            ? `${locationTitle} serves ${cityState} with clear scheduling, practical next-step guidance, and service details tailored to the request.`
            : "Most inquiries are answered quickly with current availability, scope clarification, and the best next step for the customer."
      })),
      usps: [
        "Local service coverage with transparent response windows",
        "Structured delivery process with clear customer communication"
      ],
      suggestedCategories: input.snapshot.categories.slice(0, 4),
      suggestedServices: serviceBundles.map((service) => service.serviceName).slice(0, 30),
      suggestedProducts: [],
      suggestedAttributes: input.snapshot.attributes.slice(0, 6),
      hoursRecommendations: [],
      promptVersion: BLITZ_COMPLETENESS_PROMPT_VERSION
    };
  }

  private async generateLocationSemanticSuggestions(input: {
    location: ResolvedLocation;
    snapshot: LocationRichSnapshot;
    competitors: CompetitorRecord[];
    objectives: string[];
    settings: ClientOrchestrationSettingsRecord;
    sitemapUrls?: string[];
  }): Promise<LocationSemanticSuggestions> {
    const fallback = this.buildFallbackSemanticSuggestions({
      location: input.location,
      snapshot: input.snapshot,
      objectives: input.objectives
    });
    const apiKey =
      process.env.GEMINI_API_KEY?.trim() ??
      process.env.GOOGLE_AI_STUDIO_API_KEY?.trim() ??
      process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ??
      process.env.GOOGLE_API_KEY?.trim() ??
      null;
    const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_SEMANTIC_MODEL;

    if (!apiKey) {
      return {
        ...fallback,
        warning: "Gemini API key not configured; semantic suggestions generated from fallback rules.",
        model: null,
        promptVersion: BLITZ_COMPLETENESS_PROMPT_VERSION
      };
    }

    try {
      const sitemapUrls = input.sitemapUrls ?? (await this.loadSitemapUrls(input.settings.sitemapUrl));
      const websiteUri =
        normalizeHttpUrl(input.snapshot.websiteUri) ??
        normalizeHttpUrl(input.location.websiteUri) ??
        normalizeHttpUrl(input.settings.defaultPostUrl);
      const groundTruth = await this.loadWebsiteGroundTruth({
        websiteUri,
        sitemapUrls
      });
      const prompt = this.buildCompletenessUserPrompt({
        location: input.location,
        snapshot: input.snapshot,
        competitors: input.competitors,
        objectives: input.objectives,
        rawWebsiteDump: groundTruth.rawTextDump,
        websiteSources: groundTruth.sourceUrls
      });
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: this.buildCompletenessSystemPrompt() }]
            },
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.35,
              topP: 0.85,
              maxOutputTokens: 2400,
              responseMimeType: "application/json"
            }
          })
        }
      );
      if (!response.ok) {
        const responseText = await response.text().catch(() => "");
        return {
          ...fallback,
          warning: `Gemini API returned ${response.status}; fallback suggestions applied. ${responseText.slice(0, 220)}`,
          model,
          promptVersion: BLITZ_COMPLETENESS_PROMPT_VERSION
        };
      }

      const payload = (await response.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
        }>;
      };
      const rawText = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n") ?? "";
      const parsed = parseJsonObjectFromText(rawText);
      if (!parsed) {
        return {
          ...fallback,
          warning: "Gemini output did not parse as JSON; fallback suggestions applied.",
          model,
          promptVersion: BLITZ_COMPLETENESS_PROMPT_VERSION
        };
      }

      const cityState = formatCityState(input.snapshot.storefrontAddress) ?? "the local market";
      const qaRaw = Array.isArray(parsed.qaPairs) ? parsed.qaPairs : [];
      const qaPairs = qaRaw
        .map((entry) => {
          const record = asRecord(entry);
          const question = typeof record.question === "string" ? normalizeText(record.question) : "";
          const answer = typeof record.answer === "string" ? normalizeText(record.answer) : "";
          if (!question || !answer) {
            return null;
          }
          return { question, answer };
        })
        .filter((entry): entry is { question: string; answer: string } => Boolean(entry))
        .slice(0, 20);
      const primaryCategoryRaw = typeof parsed.primaryCategory === "string" ? normalizeText(parsed.primaryCategory) : "";
      const primaryCategory = primaryCategoryRaw
        ? normalizeCategoryResourceName(primaryCategoryRaw) ?? primaryCategoryRaw
        : fallback.primaryCategory;
      const parsedServices = this.normalizeSemanticServiceBundles(parsed.services, cityState);
      const serviceBundles = parsedServices.length ? parsedServices : fallback.serviceBundles;
      const profileDescriptionRaw = typeof parsed.profileDescription === "string" ? parsed.profileDescription : "";
      const generatedProfileDescription =
        profileDescriptionRaw.trim().length > 0 ? sanitizeDeclarativeCopy(profileDescriptionRaw, 750) : "";
      const profileDescription = generatedProfileDescription || fallback.profileDescription;
      const optionalSuggestedCategories = toStringArray(parsed.suggestedCategories).slice(0, 8);
      const suggestedCategories = uniqueStrings(
        [
          ...optionalSuggestedCategories,
          ...(primaryCategory ? [primaryCategory] : []),
          ...fallback.suggestedCategories
        ],
        8
      );
      const optionalSuggestedServices = toStringArray(parsed.suggestedServices).slice(0, 30);
      const suggestedServices = uniqueStrings(
        [...serviceBundles.map((service) => service.serviceName), ...optionalSuggestedServices, ...fallback.suggestedServices],
        30
      );

      return {
        profileDescription,
        primaryCategory,
        serviceBundles,
        qaPairs: qaPairs.length ? qaPairs : fallback.qaPairs,
        usps: uniqueStrings(
          [
            ...toStringArray(parsed.usps)
              .map((value) => sanitizeDeclarativeCopy(value, 220))
              .filter(Boolean),
            ...fallback.usps
          ],
          12
        ),
        suggestedCategories,
        suggestedServices,
        suggestedProducts: uniqueStrings([...toStringArray(parsed.suggestedProducts), ...fallback.suggestedProducts], 30),
        suggestedAttributes: uniqueStrings([...toStringArray(parsed.suggestedAttributes), ...fallback.suggestedAttributes], 20),
        hoursRecommendations: uniqueStrings([...toStringArray(parsed.hoursRecommendations), ...fallback.hoursRecommendations], 10),
        model,
        promptVersion: BLITZ_COMPLETENESS_PROMPT_VERSION
      };
    } catch (error) {
      return {
        ...fallback,
        warning: error instanceof Error ? error.message : String(error),
        model,
        promptVersion: BLITZ_COMPLETENESS_PROMPT_VERSION
      };
    }
  }

  private async fetchDailyTrendTitles(): Promise<string[]> {
    try {
      const xml = await this.fetchTextWithTimeout("https://trends.google.com/trending/rss?geo=US", 12000);
      return extractRssItemTitles(xml).slice(0, 30);
    } catch {
      return [];
    }
  }

  private async fetchGoogleSuggestQuestionIntents(query: string): Promise<string[]> {
    const normalizedQuery = normalizeText(query).toLowerCase();
    if (!normalizedQuery) {
      return [];
    }

    const cacheKey = `suggest:${normalizedQuery}`;
    const cached = this.localQuestionIntentCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const endpoint = new URL("https://suggestqueries.google.com/complete/search");
      endpoint.searchParams.set("client", "firefox");
      endpoint.searchParams.set("hl", "en-US");
      endpoint.searchParams.set("q", normalizedQuery);
      const raw = await this.fetchTextWithTimeout(endpoint.toString(), 9000);

      const parsed = JSON.parse(raw) as unknown;
      let suggestions: string[] = [];
      if (Array.isArray(parsed) && Array.isArray(parsed[1])) {
        suggestions = parsed[1].map(String);
      }

      const normalized = uniqueStrings(
        suggestions
          .map((value) => normalizeQuestionText(value))
          .filter((value) => isLikelyQuestionIntent(value)),
        20
      );
      this.localQuestionIntentCache.set(cacheKey, normalized);
      return normalized;
    } catch {
      this.localQuestionIntentCache.set(cacheKey, []);
      return [];
    }
  }

  private buildLocalEntityHints(input: {
    snapshot: LocationRichSnapshot;
    competitors: CompetitorRecord[];
  }): string[] {
    const cityState = formatCityState(input.snapshot.storefrontAddress);
    const county = inferCountyFromAddress(input.snapshot.formattedAddress);
    const neighborhoods = uniqueStrings(
      input.competitors
        .map((competitor) => (competitor.formattedAddress ? extractNeighborhoodHintFromAddress(competitor.formattedAddress) : null))
        .filter((value): value is string => Boolean(value)),
      4
    );

    return uniqueStrings([cityState, county, ...neighborhoods], 8);
  }

  private async buildLocalQuestionIntentSignals(input: {
    location: ResolvedLocation;
    snapshot: LocationRichSnapshot;
    pageContext: LandingPageContext;
    sitemapUrls: string[];
    objectives: string[];
    competitors: CompetitorRecord[];
  }): Promise<string[]> {
    const cityState = formatCityState(input.snapshot.storefrontAddress) ?? "local area";
    const seedTerms = uniqueStrings(
      [
        ...input.snapshot.serviceLabels,
        ...input.snapshot.categories,
        input.pageContext.h1,
        input.pageContext.pageTitle,
        ...input.objectives,
        ...input.sitemapUrls.slice(0, 4).map((url) => summarizeUrlPath(url))
      ],
      8
    );
    const localEntities = this.buildLocalEntityHints({
      snapshot: input.snapshot,
      competitors: input.competitors
    });
    const questionQueries = uniqueStrings(
      seedTerms.flatMap((seed) => [
        `${seed} ${cityState}`,
        `how much does ${seed} cost in ${cityState}`,
        `who offers ${seed} in ${cityState}`
      ]),
      12
    );

    const collected: string[] = [];
    for (const query of questionQueries) {
      const questions = await this.fetchGoogleSuggestQuestionIntents(query);
      collected.push(...questions);
    }

    const deterministicFallback = uniqueStrings(
      [
        ...seedTerms.slice(0, 6).map((seed) => normalizeQuestionText(`How quickly can I book ${seed} in ${cityState}`)),
        ...seedTerms.slice(0, 6).map((seed) => normalizeQuestionText(`What does ${seed} include in ${cityState}`)),
        ...seedTerms
          .slice(0, 4)
          .map((seed) => normalizeQuestionText(`Who handles emergency ${seed} near ${localEntities[0] ?? cityState}`))
      ],
      20
    );

    return uniqueStrings(
      [...collected, ...deterministicFallback].map((value) => normalizeQuestionText(value)).filter((value) => isQuestionLike(value)),
      24
    );
  }

  private buildSearchIntentSignals(input: {
    location: ResolvedLocation;
    snapshot: LocationRichSnapshot;
    pageContext: LandingPageContext;
    sitemapUrls: string[];
    objectives: string[];
  }): string[] {
    const urlTopics = input.sitemapUrls.slice(0, 6).map((url) => summarizeUrlPath(url));
    const pageSignals = uniqueStrings(
      [
        input.pageContext.pageTitle,
        input.pageContext.h1,
        input.pageContext.metaDescription,
        input.pageContext.firstParagraph,
        ...input.objectives,
        ...input.snapshot.categories,
        ...urlTopics
      ],
      12
    );

    return pageSignals.slice(0, 8);
  }

  private buildCompetitorCitationSignals(competitors: CompetitorRecord[]): string[] {
    return competitors.slice(0, 5).map((competitor) => {
      const rating = competitor.rating ? `${competitor.rating.toFixed(1)} stars` : "unrated";
      const reviews = competitor.userRatingCount ? `${competitor.userRatingCount} reviews` : "limited reviews";
      return `${competitor.name}, ${competitor.primaryType ?? "local competitor"}, ${rating}, ${reviews}`;
    });
  }

  private async buildTrendSignalBundle(input: {
    location: ResolvedLocation;
    snapshot: LocationRichSnapshot;
    pageContext: LandingPageContext;
    sitemapUrls: string[];
    objectives: string[];
    competitors: CompetitorRecord[];
  }): Promise<TrendSignalBundle> {
    const trendTitles = await this.fetchDailyTrendTitles();
    const localQuestionIntents = await this.buildLocalQuestionIntentSignals({
      location: input.location,
      snapshot: input.snapshot,
      pageContext: input.pageContext,
      sitemapUrls: input.sitemapUrls,
      objectives: input.objectives,
      competitors: input.competitors
    });
    const cityState = formatCityState(input.snapshot.storefrontAddress) ?? "local market";
    const keywordPool = keywordTokens([
      ...input.objectives,
      ...input.snapshot.categories,
      input.pageContext.pageTitle ?? "",
      input.pageContext.h1 ?? ""
    ]);
    const localTrendSignals = uniqueStrings(
      [
        ...trendTitles.filter((title) => {
          const lower = title.toLowerCase();
          return keywordPool.some((token) => lower.includes(token));
        }),
        `${cityState} local service demand`,
        `${cityState} fast-response searches`,
        `${input.location.title ?? input.snapshot.title ?? "business"} seasonal buyer questions`
      ],
      6
    );

    return {
      localTrendSignals,
      localQuestionIntents,
      searchIntentSignals: this.buildSearchIntentSignals({
        location: input.location,
        snapshot: input.snapshot,
        pageContext: input.pageContext,
        sitemapUrls: input.sitemapUrls,
        objectives: input.objectives
      }),
      competitorCitationSignals: this.buildCompetitorCitationSignals(input.competitors)
    };
  }

  private configuredGeoFactBank(settings: ClientOrchestrationSettingsRecord): string[] {
    const geoContent = asRecord(asRecord(settings.metadata).geoContent);
    return uniqueStrings(
      [
        ...toStringArray(geoContent.factBank),
        ...toStringArray(geoContent.pricingFacts),
        ...toStringArray(geoContent.warrantyFacts),
        ...toStringArray(geoContent.slaFacts),
        ...toStringArray(geoContent.serviceFacts)
      ],
      30
    );
  }

  private extractGroundTruthFacts(input: {
    pageContext: LandingPageContext;
    rawTextDump: string;
    configuredFacts: string[];
  }): string[] {
    const sentenceFacts = input.rawTextDump
      .split(/(?<=[.!?])\s+/)
      .map((entry) => sanitizeDeclarativeCopy(entry, 240))
      .filter((entry) => entry.length >= 35)
      .filter((entry) => hasTechnicalSignal(entry))
      .slice(0, 18);

    return uniqueStrings(
      [
        ...input.configuredFacts,
        input.pageContext.pageTitle,
        input.pageContext.h1,
        input.pageContext.metaDescription,
        input.pageContext.firstParagraph,
        ...sentenceFacts
      ],
      30
    );
  }

  private buildFallbackGeoQaPairs(input: {
    locationTitle: string;
    localQuestionIntents: string[];
    localEntities: string[];
    technicalFact: string;
    limit: number;
  }): Array<{ question: string; answer: string }> {
    const fallbackLocalEntity = input.localEntities.slice(0, 2).join(" and ") || "the local area";
    const questionPool = uniqueStrings(
      [
        ...input.localQuestionIntents,
        normalizeQuestionText(`How quickly can ${input.locationTitle} dispatch service in ${fallbackLocalEntity}`),
        normalizeQuestionText(`What does same-day service include from ${input.locationTitle}`),
        normalizeQuestionText(`Do you service emergency requests near ${fallbackLocalEntity}`)
      ],
      Math.max(12, input.limit)
    );

    const pairs = questionPool
      .map((question) => ({
        question: normalizeQuestionText(question),
        answer: enforceGeoQaAnswerRules({
          answer: `${input.locationTitle} handles this request in ${fallbackLocalEntity}. ${input.technicalFact}`,
          maxWords: 50,
          localEntities: input.localEntities,
          fallbackLocalEntity,
          fallbackTechnicalDetail: input.technicalFact
        })
      }))
      .filter((pair) => pair.question && pair.answer);

    return pairs.slice(0, input.limit);
  }

  private buildGeoQaPrompt(input: {
    locationTitle: string;
    cityState: string;
    localEntities: string[];
    localQuestionIntents: string[];
    truthFacts: string[];
    limit: number;
  }): string {
    const localEntitiesLine = input.localEntities.length ? input.localEntities.join("; ") : input.cityState;
    const intentLine = input.localQuestionIntents.length
      ? input.localQuestionIntents.slice(0, 20).join("\n- ")
      : "No live questions captured. Generate practical local customer questions.";
    const truthLine = input.truthFacts.length ? input.truthFacts.slice(0, 28).join("\n- ") : "No explicit facts supplied.";

    return [
      "SYSTEM ROLE:",
      "You are a local GEO content architect optimizing Q&A for Google Business Profile retrieval in 2026.",
      "Return direct, factual Q&A entries for local search users.",
      "",
      "DIRECTIVES:",
      "- Use ONLY supplied ground-truth facts. Do not invent pricing, warranties, SLAs, or guarantees.",
      "- Answers must be <= 50 words.",
      "- Declarative tone, no hype.",
      "- Include at least two local entities in each answer.",
      "- Include one technical detail in each answer (equipment, process, timing, material, or measurable detail).",
      "",
      "OUTPUT FORMAT (JSON only):",
      "{",
      '  "qaPairs": [',
      '    {"question":"string","answer":"string","localEntities":["string"],"technicalDetail":"string","sourceFacts":["string"]}',
      "  ]",
      "}",
      "",
      `Generate ${input.limit} Q&A pairs.`,
      `Business: ${input.locationTitle}`,
      `Primary location: ${input.cityState}`,
      "Local entities:",
      `- ${localEntitiesLine}`,
      "Live local question intent inputs:",
      `- ${intentLine}`,
      "Ground truth facts:",
      `- ${truthLine}`,
      "",
      "Return JSON only."
    ].join("\n");
  }

  private async generateGeoQaSeedPack(input: {
    location: ResolvedLocation;
    snapshot: LocationRichSnapshot;
    settings: ClientOrchestrationSettingsRecord;
    pageContext: LandingPageContext;
    sitemapUrls: string[];
    trendSignals: TrendSignalBundle;
    competitors: CompetitorRecord[];
    limit: number;
  }): Promise<{
    qaPairs: Array<{ question: string; answer: string }>;
    provider: "gemini" | "template";
    model: string | null;
    warning?: string;
    localEntities: string[];
    truthFacts: string[];
  }> {
    const locationTitle = input.location.title ?? input.snapshot.title ?? "Business";
    const cityState = formatCityState(input.snapshot.storefrontAddress) ?? "local market";
    const localEntities = this.buildLocalEntityHints({
      snapshot: input.snapshot,
      competitors: input.competitors
    });
    const configuredFacts = this.configuredGeoFactBank(input.settings);
    const websiteUri =
      normalizeHttpUrl(input.snapshot.websiteUri) ??
      normalizeHttpUrl(input.location.websiteUri) ??
      normalizeHttpUrl(input.settings.defaultPostUrl);
    const groundTruth = await this.loadWebsiteGroundTruth({
      websiteUri,
      sitemapUrls: input.sitemapUrls
    });
    const truthFacts = this.extractGroundTruthFacts({
      pageContext: input.pageContext,
      rawTextDump: groundTruth.rawTextDump,
      configuredFacts
    });
    const technicalFact =
      truthFacts.find((fact) => hasTechnicalSignal(fact)) ??
      "Each request includes scope verification, compatibility checks, and current scheduling confirmation.";
    const fallbackPairs = this.buildFallbackGeoQaPairs({
      locationTitle,
      localQuestionIntents: input.trendSignals.localQuestionIntents,
      localEntities,
      technicalFact,
      limit: input.limit
    });

    const apiKey =
      process.env.GEMINI_API_KEY?.trim() ??
      process.env.GOOGLE_AI_STUDIO_API_KEY?.trim() ??
      process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ??
      process.env.GOOGLE_API_KEY?.trim() ??
      null;
    const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_SEMANTIC_MODEL;
    if (!apiKey) {
      return {
        qaPairs: fallbackPairs,
        provider: "template",
        model: null,
        warning: "Gemini API key not configured; GEO Q&A pack generated from deterministic template.",
        localEntities,
        truthFacts
      };
    }

    try {
      const prompt = this.buildGeoQaPrompt({
        locationTitle,
        cityState,
        localEntities,
        localQuestionIntents: input.trendSignals.localQuestionIntents,
        truthFacts,
        limit: input.limit
      });
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.25,
              topP: 0.85,
              maxOutputTokens: 2200,
              responseMimeType: "application/json"
            }
          })
        }
      );
      if (!response.ok) {
        const details = await response.text().catch(() => "");
        return {
          qaPairs: fallbackPairs,
          provider: "template",
          model,
          warning: `Gemini GEO Q&A API returned ${response.status}; fallback applied. ${details.slice(0, 180)}`,
          localEntities,
          truthFacts
        };
      }

      const payload = (await response.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{ text?: string }>;
          };
        }>;
      };
      const rawText = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n") ?? "";
      const parsed = parseJsonObjectFromText(rawText);
      const qaRaw = parsed && Array.isArray(parsed.qaPairs) ? parsed.qaPairs : [];
      const fallbackLocalEntity = localEntities.slice(0, 2).join(" and ") || cityState;
      const normalizedPairs = qaRaw
        .map((entry) => {
          const record = asRecord(entry);
          const questionRaw = typeof record.question === "string" ? record.question : "";
          const answerRaw = typeof record.answer === "string" ? record.answer : "";
          const question = normalizeQuestionText(questionRaw);
          if (!question || !isQuestionLike(question) || !answerRaw.trim()) {
            return null;
          }

          const technicalDetail = typeof record.technicalDetail === "string" ? sanitizeDeclarativeCopy(record.technicalDetail, 180) : "";
          const fallbackTechnicalDetail = technicalDetail || technicalFact;
          const answer = enforceGeoQaAnswerRules({
            answer: answerRaw,
            maxWords: 50,
            localEntities,
            fallbackLocalEntity,
            fallbackTechnicalDetail
          });
          if (!answer) {
            return null;
          }
          return {
            question,
            answer
          };
        })
        .filter((entry): entry is { question: string; answer: string } => Boolean(entry));

      const qaPairs = mergeQaPairs(normalizedPairs, fallbackPairs, input.limit);
      return {
        qaPairs,
        provider: "gemini",
        model,
        localEntities,
        truthFacts
      };
    } catch (error) {
      return {
        qaPairs: fallbackPairs,
        provider: "template",
        model,
        warning: error instanceof Error ? error.message : String(error),
        localEntities,
        truthFacts
      };
    }
  }

  private buildQaSeedArtifactBody(input: {
    locationTitle: string;
    cityState: string | null;
    qaPairs: Array<{ question: string; answer: string }>;
  }): string {
    const header = `# GBP Q&A Seed Pack\n\nBusiness: ${input.locationTitle}\nLocal area: ${input.cityState ?? "local market"}\n\nManual seeding pack for GBP Q&A because Google Business Profile discontinued the Q&A API on November 3, 2025. Review, edit, and seed manually in GBP.\n`;
    const qaBody = input.qaPairs
      .map((pair, index) => `## Q${index + 1}\nQuestion: ${pair.question}\nAnswer: ${pair.answer}`)
      .join("\n\n");
    return `${header}\n${qaBody}`.trim();
  }

  private normalizeMatchKey(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  }

  private scoreAttributeMatch(input: { suggestion: string; displayName: string }): number {
    const left = this.normalizeMatchKey(input.suggestion);
    const right = this.normalizeMatchKey(input.displayName);
    if (!left || !right) {
      return 0;
    }
    if (left === right) {
      return 100;
    }
    if (left.includes(right) || right.includes(left)) {
      return 80;
    }

    const leftTokens = new Set(left.split(" ").filter((token) => token.length >= 3));
    const rightTokens = new Set(right.split(" ").filter((token) => token.length >= 3));
    if (!leftTokens.size || !rightTokens.size) {
      return 0;
    }

    let overlap = 0;
    for (const token of leftTokens) {
      if (rightTokens.has(token)) {
        overlap += 1;
      }
    }
    const denominator = Math.max(leftTokens.size, rightTokens.size);
    return Math.round((overlap / denominator) * 100);
  }

  private buildBoolAttributeUpdates(input: {
    suggestedAttributes: string[];
    metadata: GbpAttributeMetadata[];
    maxUpdates?: number;
  }): {
    attributes: Array<Record<string, unknown>>;
    attributeMask: string[];
    unresolved: string[];
  } {
    const maxUpdates = clamp(toNumber(input.maxUpdates, 6), 1, 25);
    const boolMetadata = input.metadata
      .map((entry) => ({
        parent: typeof entry.parent === "string" ? entry.parent.trim() : "",
        displayName: typeof entry.displayName === "string" ? entry.displayName.trim() : "",
        valueType: typeof entry.valueType === "string" ? entry.valueType : "",
        deprecated: entry.deprecated === true
      }))
      .filter((entry) => entry.parent && entry.displayName && entry.valueType === "BOOL" && !entry.deprecated);

    const usedParents = new Set<string>();
    const attributes: Array<Record<string, unknown>> = [];
    const attributeMask: string[] = [];
    const unresolved: string[] = [];

    for (const suggestionRaw of input.suggestedAttributes) {
      const suggestion = suggestionRaw.trim();
      if (!suggestion) {
        continue;
      }

      let best: { parent: string; displayName: string; score: number } | null = null;
      for (const candidate of boolMetadata) {
        if (usedParents.has(candidate.parent)) {
          continue;
        }
        const score = this.scoreAttributeMatch({
          suggestion,
          displayName: candidate.displayName
        });
        if (!best || score > best.score) {
          best = {
            parent: candidate.parent,
            displayName: candidate.displayName,
            score
          };
        }
      }

      if (!best || best.score < 60) {
        unresolved.push(suggestion);
        continue;
      }

      usedParents.add(best.parent);
      attributes.push({
        name: best.parent,
        values: [true]
      });
      attributeMask.push(best.parent);

      if (attributes.length >= maxUpdates) {
        break;
      }
    }

    return {
      attributes,
      attributeMask: [...new Set(attributeMask)],
      unresolved
    };
  }

  private normalizeSpecialHoursPayload(value: unknown): Record<string, unknown> | null {
    const record = asRecord(value);
    const fromRecord = Array.isArray(record.specialHourPeriods) ? record.specialHourPeriods : null;
    const fromArray = Array.isArray(value) ? value : null;
    const periods = (fromRecord ?? fromArray ?? [])
      .map((entry) => asRecord(entry))
      .filter((entry) => Object.keys(entry).length > 0)
      .slice(0, 60);
    if (!periods.length) {
      return null;
    }
    return {
      specialHourPeriods: periods
    };
  }

  private buildCategoryPatchRecommendations(input: {
    primaryCategory: string | null;
    suggestedCategories: string[];
  }): Array<Record<string, unknown>> {
    const candidates = uniqueStrings([input.primaryCategory, ...input.suggestedCategories], 4);
    return candidates.map((candidate) => {
      const resourceName = normalizeCategoryResourceName(candidate);
      if (resourceName) {
        return {
          name: resourceName
        };
      }
      return {
        displayName: candidate
      };
    });
  }

  private buildServiceItemsForPatch(input: {
    categoryResourceName: string | null;
    serviceBundles: SemanticServiceBundle[];
    suggestedServices: string[];
    suggestedProducts: string[];
  }): Array<Record<string, unknown>> {
    if (!input.categoryResourceName) {
      return [];
    }

    const seen = new Set<string>();
    const serviceItems: Array<Record<string, unknown>> = [];
    const fallbackBundles = [...input.suggestedServices, ...input.suggestedProducts].map((label) => ({
      serviceName: label,
      serviceDescription: ""
    }));
    const normalizedBundles = [...input.serviceBundles, ...fallbackBundles];
    for (const bundle of normalizedBundles) {
      const serviceName = sanitizeEntityLabel(bundle.serviceName, 120);
      if (!serviceName) {
        continue;
      }
      const serviceDescription = sanitizeDeclarativeCopy(bundle.serviceDescription, 300);
      const labelRaw = serviceDescription ? `${serviceName}: ${serviceDescription}` : serviceName;
      const label = normalizeText(truncateChars(labelRaw, 140));
      if (!label) {
        continue;
      }
      const key = label.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      serviceItems.push({
        freeFormServiceItem: {
          category: input.categoryResourceName,
          label: {
            displayName: label,
            languageCode: "en-US"
          }
        }
      });
      if (serviceItems.length >= 30) {
        break;
      }
    }
    return serviceItems;
  }

  private selectProductLandingUrls(input: {
    sitemapUrls: string[];
    fallbackWebsite: string | null;
    suggestedProducts: string[];
  }): string[] {
    const results: string[] = [];
    const seen = new Set<string>();
    const lowerSitemap = input.sitemapUrls.map((url) => ({ url, lower: url.toLowerCase() }));
    const push = (value: string | null | undefined) => {
      const normalized = normalizeHttpUrl(value ?? null);
      if (!normalized || seen.has(normalized)) {
        return;
      }
      seen.add(normalized);
      results.push(normalized);
    };

    for (const suggestion of input.suggestedProducts) {
      const tokens = this.normalizeMatchKey(suggestion)
        .split(" ")
        .filter((token) => token.length >= 4);
      if (!tokens.length) {
        continue;
      }
      const matched = lowerSitemap.find((entry) => tokens.some((token) => entry.lower.includes(token)));
      if (matched) {
        push(matched.url);
      }
      if (results.length >= 4) {
        break;
      }
    }

    if (results.length < 4) {
      for (const candidate of lowerSitemap) {
        if (/(product|shop|service|offer|menu|book)/.test(candidate.lower)) {
          push(candidate.url);
        }
        if (results.length >= 4) {
          break;
        }
      }
    }

    if (results.length < 4 && input.sitemapUrls.length) {
      push(input.sitemapUrls[0]);
    }

    if (results.length < 4) {
      push(input.fallbackWebsite);
    }

    return results.slice(0, 4);
  }

  private buildProductPlaceActionLinks(input: {
    sitemapUrls: string[];
    fallbackWebsite: string | null;
    suggestedProducts: string[];
  }): Array<Record<string, unknown>> {
    const selectedUrls = this.selectProductLandingUrls({
      sitemapUrls: input.sitemapUrls,
      fallbackWebsite: input.fallbackWebsite,
      suggestedProducts: input.suggestedProducts
    });
    return selectedUrls.map((uri, index) => ({
      uri,
      placeActionType: "SHOP_ONLINE",
      isPreferred: index === 0
    }));
  }

  private async runCompetitorBenchmark(input: {
    context: RunContext;
  }): Promise<Array<Record<string, unknown>>> {
    const rows: Array<Record<string, unknown>> = [];
    for (const location of input.context.locations) {
      const snapshot = await this.fetchLocationSnapshot({ context: input.context, location });
      const competitors = await this.discoverTopCompetitors({
        snapshot,
        location,
        objectives: input.context.settings.objectives,
        maxResults: 5
      });
      const avgCompetitorRating = safeAverage(
        competitors.map((competitor) => competitor.rating ?? 0).filter((value) => value > 0)
      );
      const avgCompetitorReviewCount = safeAverage(
        competitors.map((competitor) => competitor.userRatingCount ?? 0).filter((value) => value > 0)
      );

      const missing: string[] = [];
      if (!snapshot.categories.length) {
        missing.push("categories");
      }
      if (!snapshot.profileDescription) {
        missing.push("profile.description");
      }
      if (!snapshot.websiteUri) {
        missing.push("websiteUri");
      }
      if (!snapshot.regularHours) {
        missing.push("regularHours");
      }
      if (!snapshot.specialHours) {
        missing.push("specialHours");
      }
      if (!snapshot.attributes.length) {
        missing.push("attributes");
      }

      rows.push({
        accountId: location.accountId,
        locationName: location.locationName,
        title: snapshot.title ?? location.title,
        missing,
        benchmark: {
          reviewCount: snapshot.reviewCount,
          averageRating: Number(snapshot.averageRating.toFixed(2)),
          postCount30d: snapshot.postCount30d,
          avgCompetitorRating: Number(avgCompetitorRating.toFixed(2)),
          avgCompetitorReviewCount: Math.round(avgCompetitorReviewCount),
          ratingDeltaVsCompetitors: Number((snapshot.averageRating - avgCompetitorRating).toFixed(2)),
          reviewDeltaVsCompetitors: Math.round(snapshot.reviewCount - avgCompetitorReviewCount)
        },
        competitors
      });
    }
    return rows;
  }

  private shouldAutoApplyRiskyChanges(context: RunContext): boolean {
    const metadata = asRecord(context.settings.metadata);
    return metadata.allowAutoApplyRiskyPatches === true;
  }

  private async queueActionNeeded(input: {
    action: BlitzAction;
    organizationId: string;
    clientId: string;
    location: ResolvedLocation;
    title: string;
    description: string;
    patch: Record<string, unknown>;
    updateMask: string[];
    operations?: Array<Record<string, unknown>>;
    objective: string;
    actionType?: "profile_patch" | "media_upload" | "post_publish" | "review_reply" | "hours_update" | "attribute_update";
    riskTier?: "low" | "medium" | "high" | "critical";
    metadata?: Record<string, unknown>;
  }): Promise<string> {
    const operationPlan = input.operations?.length
      ? input.operations
      : [
          {
            kind: "patch_location",
            patch: input.patch,
            updateMask: input.updateMask
          }
        ];
    const payload: Record<string, unknown> = {
      objective: input.objective,
      locationName: input.location.locationName,
      locationId: input.location.locationId,
      patch: input.patch,
      updateMask: input.updateMask,
      executionPlan: {
        version: 1,
        operations: operationPlan
      },
      ...(input.metadata ?? {})
    };

    const fingerprint = buildFingerprint({
      clientId: input.clientId,
      locationName: input.location.locationName,
      objective: input.objective,
      payload
    });

    const created = await this.deps.repository.createActionNeeded({
      organizationId: input.organizationId,
      clientId: input.clientId,
      runId: input.action.runId,
      sourceActionId: input.action.id,
      provider: "gbp",
      locationName: input.location.locationName,
      locationId: input.location.locationId,
      actionType: input.actionType ?? "profile_patch",
      riskTier: input.riskTier ?? "high",
      title: input.title,
      description: input.description,
      fingerprint,
      payload
    });

    return created.id;
  }

  private async executeProfilePatch(input: {
    action: BlitzAction;
    context: RunContext;
    objective: string;
  }): Promise<Record<string, unknown>> {
    const patchPayload = asRecord(input.action.payload.patch);
    const updateMask = toStringArray(input.action.payload.updateMask);

    if (Object.keys(patchPayload).length > 0 && updateMask.length > 0) {
      const patched: Array<Record<string, unknown>> = [];
      const failed: Array<Record<string, unknown>> = [];
      for (const location of input.context.locations) {
        try {
          await input.context.client.patchLocation(location.locationName, patchPayload, updateMask);
          patched.push({
            locationName: location.locationName,
            title: location.title
          });
        } catch (error) {
          failed.push({
            locationName: location.locationName,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      if (!patched.length) {
        throw new Error(`Profile patch failed for all scoped locations: ${failed[0]?.error ?? "unknown error"}`);
      }

      return {
        objective: input.objective,
        patchedLocations: patched,
        failedLocations: failed,
        warnings: input.context.warnings
      };
    }

    if (input.objective === "ai_description_qna_optimization") {
      const autoApplyRisky = this.shouldAutoApplyRiskyChanges(input.context);
      const patched: Array<Record<string, unknown>> = [];
      const queued: Array<Record<string, unknown>> = [];
      const skipped: Array<Record<string, unknown>> = [];
      const failed: Array<Record<string, unknown>> = [];
      const warnings = [...input.context.warnings];
      const generatedQaPayloads: Array<Record<string, unknown>> = [];

      for (const location of input.context.locations) {
        const snapshot = await this.fetchLocationSnapshot({ context: input.context, location });
        const competitors = await this.discoverTopCompetitors({
          snapshot,
          location,
          objectives: input.context.settings.objectives,
          maxResults: 5
        });
        const suggestions = await this.generateLocationSemanticSuggestions({
          location,
          snapshot,
          competitors,
          objectives: input.context.settings.objectives,
          settings: input.context.settings
        });
        if (suggestions.warning) {
          warnings.push(`${location.locationName}: ${suggestions.warning}`);
        }

        generatedQaPayloads.push({
          locationName: location.locationName,
          title: snapshot.title ?? location.title,
          primaryCategory: suggestions.primaryCategory,
          serviceBundles: suggestions.serviceBundles,
          qaPairs: suggestions.qaPairs,
          usps: suggestions.usps,
          suggestedCategories: suggestions.suggestedCategories,
          suggestedServices: suggestions.suggestedServices,
          suggestedProducts: suggestions.suggestedProducts,
          suggestedAttributes: suggestions.suggestedAttributes,
          hoursRecommendations: suggestions.hoursRecommendations,
          model: suggestions.model ?? null,
          promptVersion: suggestions.promptVersion ?? null
        });

        const nextDescription = suggestions.profileDescription ? normalizeText(suggestions.profileDescription) : "";
        const currentDescription = snapshot.profileDescription ? normalizeText(snapshot.profileDescription) : "";
        if (!nextDescription || nextDescription === currentDescription) {
          skipped.push({
            locationName: location.locationName,
            reason: nextDescription ? "description_unchanged" : "no_description_generated"
          });
          continue;
        }

        const patch = {
          profile: {
            description: nextDescription
          }
        };
        const updateMaskForDescription = ["profile"];

        if (!autoApplyRisky) {
          try {
            const actionNeededId = await this.queueActionNeeded({
              action: input.action,
              organizationId: input.action.organizationId ?? input.context.connection.organizationId,
              clientId: input.action.clientId ?? input.context.connection.clientId,
              location,
              objective: input.objective,
              title: "Approve GBP profile description optimization",
              description:
                "Worker generated a new hyperlocal GBP description and Q&A recommendations. Approve to apply the description patch.",
              patch,
              updateMask: updateMaskForDescription,
              riskTier: "high",
              metadata: {
                competitorCount: competitors.length,
                previousDescriptionLength: currentDescription.length,
                nextDescriptionLength: nextDescription.length,
                primaryCategory: suggestions.primaryCategory,
                serviceBundles: suggestions.serviceBundles,
                qaPairs: suggestions.qaPairs,
                suggestedCategories: suggestions.suggestedCategories,
                suggestedServices: suggestions.suggestedServices,
                suggestedProducts: suggestions.suggestedProducts,
                suggestedAttributes: suggestions.suggestedAttributes,
                promptVersion: suggestions.promptVersion ?? null
              }
            });
            queued.push({
              actionNeededId,
              locationName: location.locationName,
              title: snapshot.title ?? location.title
            });
          } catch (error) {
            failed.push({
              locationName: location.locationName,
              error: error instanceof Error ? error.message : String(error)
            });
          }
          continue;
        }

        try {
          await input.context.client.patchLocation(location.locationName, patch, updateMaskForDescription);
          patched.push({
            locationName: location.locationName,
            title: snapshot.title ?? location.title,
            previousDescriptionLength: currentDescription.length,
            nextDescriptionLength: nextDescription.length,
            competitorCount: competitors.length
          });
        } catch (error) {
          failed.push({
            locationName: location.locationName,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      if (!patched.length && failed.length && !skipped.length) {
        throw new Error(`AI description optimization failed for all locations: ${failed[0]?.error ?? "unknown error"}`);
      }

      return {
        objective: input.objective,
        autoApplyRiskyChanges: autoApplyRisky,
        patchedLocations: patched,
        queuedApprovals: queued,
        skippedLocations: skipped,
        failedLocations: failed,
        qaOptimization: {
          apiStatus: "qa_api_deprecated_manual_queue_only",
          locationCount: generatedQaPayloads.length,
          generatedQaPayloads
        },
        warnings
      };
    }

    const checks = await Promise.all(
      input.context.locations.slice(0, 10).map(async (location) => {
        const snapshot = await this.fetchLocationSnapshot({ context: input.context, location });
        return {
          accountId: location.accountId,
          locationName: location.locationName,
          title: snapshot.title ?? location.title,
          hasCategories: snapshot.categories.length > 0,
          hasHours: Boolean(snapshot.regularHours),
          hasAttributes: snapshot.attributes.length > 0,
          hasProfileDescription: Boolean(snapshot.profileDescription),
          reviewCount: snapshot.reviewCount,
          averageRating: Number(snapshot.averageRating.toFixed(2)),
          postCount30d: snapshot.postCount30d
        };
      })
    );

    return {
      objective: input.objective,
      mode: "read_only_snapshot",
      accountCount: [...new Set(input.context.locations.map((location) => location.accountId))].length,
      locationCount: input.context.locations.length,
      checkedLocations: checks,
      warnings: input.context.warnings
    };
  }

  private async executeAttributeUpdate(input: {
    action: BlitzAction;
    context: RunContext;
  }): Promise<Record<string, unknown>> {
    const objective =
      typeof input.action.payload.objective === "string"
        ? input.action.payload.objective
        : "completeness_gap_matrix";

    if (objective === "competitor_benchmark_and_gap_matrix") {
      const matrix = await this.runCompetitorBenchmark({
        context: input.context
      });
      return {
        objective,
        locationsAnalyzed: matrix.length,
        benchmarked: true,
        gapMatrix: matrix
      };
    }

    if (objective === "auto_fill_profile_fields") {
      const applyRecommendations = input.action.payload.applyRecommendations !== false;
      const autoApplyRisky = this.shouldAutoApplyRiskyChanges(input.context);
      const explicitHours = asRecord(input.action.payload.defaultRegularHours);
      const metadataHours = asRecord(asRecord(input.context.settings.metadata).defaultRegularHours);
      const defaultHours = Object.keys(explicitHours).length ? explicitHours : metadataHours;
      const explicitSpecialHours = this.normalizeSpecialHoursPayload(input.action.payload.defaultSpecialHours);
      const metadataSpecialHours = this.normalizeSpecialHoursPayload(asRecord(input.context.settings.metadata).defaultSpecialHours);
      const defaultSpecialHours = explicitSpecialHours ?? metadataSpecialHours;
      const sitemapUrls = await this.loadSitemapUrls(input.context.settings.sitemapUrl);
      if (normalizeHttpUrl(input.context.settings.sitemapUrl) && sitemapUrls.length === 0) {
        input.context.warnings.push(
          "Configured sitemap URL did not return usable page URLs for products link upserts."
        );
      }

      const patched: Array<Record<string, unknown>> = [];
      const queued: Array<Record<string, unknown>> = [];
      const skipped: Array<Record<string, unknown>> = [];
      const failed: Array<Record<string, unknown>> = [];
      const warnings = [...input.context.warnings];

      for (const location of input.context.locations) {
        const snapshot = await this.fetchLocationSnapshot({ context: input.context, location });
        const competitors = await this.discoverTopCompetitors({
          snapshot,
          location,
          objectives: input.context.settings.objectives,
          maxResults: 5
        });
        const suggestions = await this.generateLocationSemanticSuggestions({
          location,
          snapshot,
          competitors,
          objectives: input.context.settings.objectives,
          settings: input.context.settings,
          sitemapUrls
        });
        if (suggestions.warning) {
          warnings.push(`${location.locationName}: ${suggestions.warning}`);
        }

        const patch: Record<string, unknown> = {};
        const updateMask: string[] = [];
        const unavailableWrites: string[] = [];
        let attributeOperations: {
          attributes: Array<Record<string, unknown>>;
          attributeMask: string[];
          unresolved: string[];
        } = {
          attributes: [],
          attributeMask: [],
          unresolved: []
        };
        let attributeMetadataCount = 0;
        let productLinks: Array<Record<string, unknown>> = [];

        const profileDescription = suggestions.profileDescription ? suggestions.profileDescription.trim() : "";
        if (profileDescription) {
          patch.profile = {
            description: profileDescription
          };
          updateMask.push("profile");
        }

        if (!snapshot.websiteUri) {
          const fallbackWebsite =
            normalizeHttpUrl(input.context.settings.defaultPostUrl) ??
            normalizeHttpUrl(location.websiteUri);
          if (fallbackWebsite) {
            patch.websiteUri = fallbackWebsite;
            updateMask.push("websiteUri");
          }
        }

        if (!snapshot.categories.length) {
          const categoryRecommendations = this.buildCategoryPatchRecommendations({
            primaryCategory: suggestions.primaryCategory,
            suggestedCategories: suggestions.suggestedCategories
          });
          if (categoryRecommendations.length) {
            patch.categories = categoryRecommendations;
            updateMask.push("categories");
          }
        }

        if (!snapshot.regularHours && Object.keys(defaultHours).length > 0) {
          patch.regularHours = defaultHours;
          updateMask.push("regularHours");
        }

        if (!snapshot.specialHours && defaultSpecialHours) {
          patch.specialHours = defaultSpecialHours;
          updateMask.push("specialHours");
        }

        const categoryResourceName = snapshot.categoryResourceNames[0] ?? null;
        const serviceItems = this.buildServiceItemsForPatch({
          categoryResourceName,
          serviceBundles: suggestions.serviceBundles,
          suggestedServices: suggestions.suggestedServices,
          suggestedProducts: suggestions.suggestedProducts
        });
        if (serviceItems.length) {
          patch.serviceItems = serviceItems;
          updateMask.push("serviceItems");
        } else if (suggestions.suggestedServices.length > 0 || suggestions.suggestedProducts.length > 0) {
          unavailableWrites.push(
            categoryResourceName ? "serviceItems_not_generated" : "serviceItems_missing_category_resource_name"
          );
        }

        if (suggestions.suggestedAttributes.length > 0) {
          try {
            const metadata = await input.context.client.listAttributeMetadata({
              parentLocationName: location.locationName,
              languageCode: "en",
              pageSize: 200
            });
            attributeMetadataCount = metadata.length;
            attributeOperations = this.buildBoolAttributeUpdates({
              suggestedAttributes: suggestions.suggestedAttributes,
              metadata,
              maxUpdates: 8
            });
            if (!attributeOperations.attributeMask.length) {
              unavailableWrites.push("attributes_no_safe_bool_match");
            } else if (attributeOperations.unresolved.length) {
              unavailableWrites.push("attributes_partial_match");
            }
          } catch (error) {
            unavailableWrites.push("attributes_metadata_unavailable");
            warnings.push(
              `${location.locationName}: failed to resolve attribute metadata (${error instanceof Error ? error.message : String(error)})`
            );
          }
        }

        if (suggestions.suggestedProducts.length > 0) {
          const fallbackWebsite =
            normalizeHttpUrl(snapshot.websiteUri) ??
            normalizeHttpUrl(location.websiteUri) ??
            normalizeHttpUrl(input.context.settings.defaultPostUrl);
          productLinks = this.buildProductPlaceActionLinks({
            sitemapUrls,
            fallbackWebsite,
            suggestedProducts: suggestions.suggestedProducts
          });
          if (!productLinks.length) {
            unavailableWrites.push("product_links_missing_urls");
          }
        }

        if (suggestions.suggestedAttributes.length > 0) {
          if (attributeOperations.unresolved.length) {
            unavailableWrites.push("attributes_unresolved_suggestions");
          }
        }
        if (suggestions.qaPairs.length > 0) {
          unavailableWrites.push("q_and_a");
        }

        const dedupedMask = [...new Set(updateMask)];
        const operations: Array<Record<string, unknown>> = [];
        if (dedupedMask.length) {
          operations.push({
            kind: "patch_location",
            patch,
            updateMask: dedupedMask
          });
        }
        if (attributeOperations.attributeMask.length) {
          operations.push({
            kind: "update_attributes",
            attributes: attributeOperations.attributes,
            attributeMask: attributeOperations.attributeMask
          });
        }
        if (productLinks.length) {
          operations.push({
            kind: "upsert_place_action_links",
            links: productLinks
          });
        }

        if (!applyRecommendations) {
          skipped.push({
            locationName: location.locationName,
            reason: "apply_recommendations_disabled",
            suggestedUpdateMask: dedupedMask,
            operationKinds: operations.map((entry) => String(entry.kind ?? "unknown")),
            unavailableWrites
          });
          continue;
        }

        if (!operations.length) {
          skipped.push({
            locationName: location.locationName,
            reason: "no_mutable_operations_needed",
            unavailableWrites
          });
          continue;
        }

        if (!autoApplyRisky) {
          try {
            const actionNeededId = await this.queueActionNeeded({
              action: input.action,
              organizationId: input.action.organizationId ?? input.context.connection.organizationId,
              clientId: input.action.clientId ?? input.context.connection.clientId,
              location,
              objective,
              actionType: "attribute_update",
              title: "Approve GBP completeness auto-fill patch",
              description:
                "Worker prepared GBP completeness updates (profile/category/hours/services/special hours/attributes/product links). Approve to execute or complete manually.",
              patch,
              updateMask: dedupedMask,
              operations,
              riskTier: "high",
              metadata: {
                unavailableWrites,
                attributeMetadataCount,
                operationKinds: operations.map((entry) => String(entry.kind ?? "unknown")),
                suggestions: {
                  primaryCategory: suggestions.primaryCategory,
                  serviceBundles: suggestions.serviceBundles,
                  usps: suggestions.usps,
                  categories: suggestions.suggestedCategories,
                  services: suggestions.suggestedServices,
                  products: suggestions.suggestedProducts,
                  attributes: suggestions.suggestedAttributes,
                  hoursRecommendations: suggestions.hoursRecommendations,
                  qaPairs: suggestions.qaPairs,
                  promptVersion: suggestions.promptVersion ?? null
                },
                derived: {
                  attributeMask: attributeOperations.attributeMask,
                  unresolvedAttributes: attributeOperations.unresolved,
                  serviceItemsCount: serviceItems.length,
                  productLinksCount: productLinks.length
                }
              }
            });
            queued.push({
              actionNeededId,
              locationName: location.locationName,
              title: snapshot.title ?? location.title,
              updateMask: dedupedMask,
              operationKinds: operations.map((entry) => String(entry.kind ?? "unknown"))
            });
          } catch (error) {
            failed.push({
              locationName: location.locationName,
              updateMask: dedupedMask,
              error: error instanceof Error ? error.message : String(error),
              unavailableWrites
            });
          }
          continue;
        }

        try {
          const executedOperations: Array<Record<string, unknown>> = [];
          if (dedupedMask.length) {
            await input.context.client.patchLocation(location.locationName, patch, dedupedMask);
            executedOperations.push({
              kind: "patch_location",
              updateMask: dedupedMask
            });
          }
          if (attributeOperations.attributeMask.length) {
            await input.context.client.updateLocationAttributes({
              locationName: location.locationName,
              attributes: attributeOperations.attributes,
              attributeMask: attributeOperations.attributeMask
            });
            executedOperations.push({
              kind: "update_attributes",
              attributeMask: attributeOperations.attributeMask,
              updatedCount: attributeOperations.attributes.length
            });
          }
          if (productLinks.length) {
            const existingLinks = await input.context.client.listPlaceActionLinks(location.locationId);
            const existingByKey = new Map<string, { name?: string }>();
            for (const link of existingLinks) {
              const uri = normalizeHttpUrl(typeof link.uri === "string" ? link.uri : null);
              const placeActionType = typeof link.placeActionType === "string" ? link.placeActionType.toUpperCase() : null;
              if (!uri || !placeActionType) {
                continue;
              }
              existingByKey.set(`${placeActionType}|${uri}`, { name: link.name });
            }

            let created = 0;
            let updated = 0;
            let skippedProductLinks = 0;
            for (const rawLink of productLinks) {
              const record = asRecord(rawLink);
              const uri = normalizeHttpUrl(typeof record.uri === "string" ? record.uri : null);
              const placeActionTypeRaw =
                typeof record.placeActionType === "string" ? record.placeActionType.toUpperCase() : "SHOP_ONLINE";
              const isPreferred = record.isPreferred === true;
              if (!uri) {
                skippedProductLinks += 1;
                continue;
              }
              const key = `${placeActionTypeRaw}|${uri}`;
              const existing = existingByKey.get(key);
              if (existing?.name) {
                await input.context.client.patchPlaceActionLink(
                  existing.name,
                  {
                    uri,
                    placeActionType: placeActionTypeRaw,
                    isPreferred
                  },
                  ["uri", "placeActionType", "isPreferred"]
                );
                updated += 1;
                continue;
              }

              await input.context.client.createPlaceActionLink(location.locationId, {
                uri,
                placeActionType: placeActionTypeRaw,
                isPreferred
              });
              created += 1;
            }

            executedOperations.push({
              kind: "upsert_place_action_links",
              requested: productLinks.length,
              created,
              updated,
              skipped: skippedProductLinks
            });
          }

          patched.push({
            locationName: location.locationName,
            title: snapshot.title ?? location.title,
            updateMask: dedupedMask,
            operations: executedOperations,
            unavailableWrites,
            suggestions: {
              primaryCategory: suggestions.primaryCategory,
              serviceBundles: suggestions.serviceBundles,
              usps: suggestions.usps,
              categories: suggestions.suggestedCategories,
              services: suggestions.suggestedServices,
              products: suggestions.suggestedProducts,
              attributes: suggestions.suggestedAttributes,
              hoursRecommendations: suggestions.hoursRecommendations,
              qaPairs: suggestions.qaPairs,
              promptVersion: suggestions.promptVersion ?? null
            }
          });
        } catch (error) {
          failed.push({
            locationName: location.locationName,
            updateMask: dedupedMask,
            error: error instanceof Error ? error.message : String(error),
            unavailableWrites
          });
        }
      }

      if (!patched.length && failed.length && !skipped.length) {
        throw new Error(`Auto-fill profile fields failed for all locations: ${failed[0]?.error ?? "unknown error"}`);
      }

      return {
        objective,
        applyRecommendations,
        autoApplyRiskyChanges: autoApplyRisky,
        patchedLocations: patched,
        queuedApprovals: queued,
        skippedLocations: skipped,
        failedLocations: failed,
        warnings
      };
    }

    const matrix = await Promise.all(
      input.context.locations.map(async (location) => {
        const snapshot = await this.fetchLocationSnapshot({ context: input.context, location });
        const missing: string[] = [];
        if (!snapshot.categories.length) {
          missing.push("categories");
        }
        if (!snapshot.regularHours) {
          missing.push("regularHours");
        }
        if (!snapshot.specialHours) {
          missing.push("specialHours");
        }
        if (!snapshot.attributes.length) {
          missing.push("attributes");
        }
        if (!snapshot.profileDescription) {
          missing.push("profile.description");
        }
        if (!snapshot.websiteUri) {
          missing.push("websiteUri");
        }

        return {
          accountId: location.accountId,
          locationName: location.locationName,
          title: snapshot.title ?? location.title,
          missing,
          reviewCount: snapshot.reviewCount,
          averageRating: Number(snapshot.averageRating.toFixed(2)),
          postCount30d: snapshot.postCount30d
        };
      })
    );

    return {
      objective,
      locationsAnalyzed: matrix.length,
      gapMatrix: matrix
    };
  }

  private buildMediaFloodNaturalFileName(input: {
    locationTitle: string;
    cityState: string | null;
    variantType: MediaFloodUploadCandidate["variantType"];
    entityHints?: string[];
    ordinal: number;
    extension: string;
  }): string {
    const businessSlug = sanitizeStorageSegment(input.locationTitle.toLowerCase()).slice(0, 42) || "business";
    const citySlug = sanitizeStorageSegment((input.cityState ?? "local").toLowerCase()).slice(0, 26) || "local";
    const entitySlug = sanitizeStorageSegment(
      (input.entityHints ?? [])
        .map((value) => value.toLowerCase())
        .join("-")
    )
      .slice(0, 38)
      .replace(/-+/g, "-");
    const variantSlug = sanitizeStorageSegment(input.variantType.toLowerCase()).slice(0, 28) || "media";
    const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const entityPart = entitySlug ? `-${entitySlug}` : "";
    return `${businessSlug}${entityPart}-${citySlug}-${variantSlug}-${dateStamp}-${String(input.ordinal).padStart(3, "0")}.${input.extension}`;
  }

  private mediaCategoryForVariant(
    variantType: MediaFloodUploadCandidate["variantType"],
    mediaFormat: MediaFloodUploadCandidate["mediaFormat"]
  ): string {
    if (mediaFormat === "VIDEO") {
      return "ADDITIONAL";
    }
    switch (variantType) {
      case "action_shot":
        return "AT_WORK";
      case "team_photo":
        return "TEAM";
      case "story_vertical":
        return "ADDITIONAL";
      case "virtual_tour_360":
        return "INTERIOR";
      default:
        return "ADDITIONAL";
    }
  }

  private buildFallbackVisionMetadata(input: {
    locationTitle: string;
    variantType: MediaFloodUploadCandidate["variantType"];
    cityState: string | null;
    objectives: string[];
    tags?: string[];
  }): VisionAssetMetadata {
    const readableVariant = input.variantType.replace(/_/g, " ");
    const cityLine = input.cityState ? ` in ${input.cityState}` : "";
    const objectiveHints = uniqueStrings(input.objectives.map((objective) => readableObjective(objective)), 3);
    const objectiveLine = objectiveHints.length ? objectiveHints.join(", ") : "local services";
    const caption = sanitizeDeclarativeCopy(
      `${input.locationTitle} ${readableVariant} update${cityLine} documenting ${objectiveLine}.`,
      220
    );
    return {
      caption,
      altText: sanitizeDeclarativeCopy(`${input.locationTitle} ${readableVariant} visual`, 140),
      tags: [...new Set(["gbp", "local", input.variantType, ...(input.tags ?? [])])].slice(0, 14),
      entities: uniqueStrings([input.locationTitle, ...(input.objectives ?? []), ...(input.tags ?? [])], 8),
      sceneType: input.variantType,
      qualityScore: 72,
      isSafe: true,
      isRelevant: true,
      moderationRisk: "low",
      serviceRelevanceScore: 72,
      rejectionReasons: []
    };
  }

  private async generateVisionMetadataForImage(input: {
    imageBuffer: Buffer;
    mimeType: string;
    locationTitle: string;
    variantType: MediaFloodUploadCandidate["variantType"];
    objectives: string[];
    cityState: string | null;
    fallbackTags?: string[];
    enableVision: boolean;
  }): Promise<VisionAssetMetadata> {
    const fallback = this.buildFallbackVisionMetadata({
      locationTitle: input.locationTitle,
      variantType: input.variantType,
      cityState: input.cityState,
      objectives: input.objectives,
      tags: input.fallbackTags
    });

    if (!input.enableVision) {
      return {
        ...fallback,
        warning: "Vision analysis disabled for this run.",
        model: null
      };
    }

    const apiKey =
      process.env.GEMINI_API_KEY?.trim() ??
      process.env.GOOGLE_AI_STUDIO_API_KEY?.trim() ??
      process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ??
      process.env.GOOGLE_API_KEY?.trim() ??
      null;
    const model = process.env.GEMINI_VISION_MODEL?.trim() || process.env.GEMINI_MODEL?.trim() || "gemini-2.0-flash";
    if (!apiKey) {
      return {
        ...fallback,
        warning: "Gemini API key not configured; media captions generated from fallback rules.",
        model: null
      };
    }

    const objectiveLine = input.objectives.length ? input.objectives.join("; ") : "Increase local visibility and conversions";
    const prompt = [
      "You are a local SEO media optimizer for Google Business Profile.",
      "Analyze the attached media and produce safety verification, service relevance scoring, entity labels, and concise factual metadata.",
      "",
      "Return STRICT JSON only:",
      "{",
      '  "caption": "string",',
      '  "altText": "string",',
      '  "tags": ["string"],',
      '  "entities": ["string"],',
      '  "sceneType": "string",',
      '  "qualityScore": 0,',
      '  "isSafe": true,',
      '  "isRelevant": true,',
      '  "moderationRisk": "low|medium|high",',
      '  "serviceRelevanceScore": 0,',
      '  "rejectionReasons": ["string"]',
      "}",
      "",
      "Rules:",
      "- caption max 220 chars; human and specific; no hype.",
      "- altText max 140 chars.",
      "- tags 4-12 short lowercase tags.",
      "- entities must include concrete visual nouns (equipment, tools, landmarks, signage, service contexts).",
      "- qualityScore integer 0-100.",
      "- serviceRelevanceScore integer 0-100.",
      "- isSafe is false for explicit content, violence, hateful symbols, or clear spam/watermark abuse.",
      "- isRelevant is false when the media does not represent this business service context.",
      "- moderationRisk must be low, medium, or high.",
      "- rejectionReasons required when isSafe=false or isRelevant=false.",
      "- Avoid unverifiable claims.",
      "",
      `Business: ${input.locationTitle}`,
      `Variant Type: ${input.variantType}`,
      `City/State: ${input.cityState ?? "local area"}`,
      `Objectives: ${objectiveLine}`,
      `Allowed service context hints: ${uniqueStrings(input.objectives.map((objective) => readableObjective(objective)), 8).join(", ") || "local services"}`,
      "Return JSON only."
    ].join("\n");

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [
                  { text: prompt },
                  {
                    inlineData: {
                      mimeType: input.mimeType || "image/jpeg",
                      data: input.imageBuffer.toString("base64")
                    }
                  }
                ]
              }
            ],
            generationConfig: {
              temperature: 0.35,
              topP: 0.9,
              maxOutputTokens: 560,
              responseMimeType: "application/json"
            }
          })
        }
      );

      if (!response.ok) {
        return {
          ...fallback,
          warning: `Gemini vision API returned ${response.status}; fallback metadata applied.`,
          model
        };
      }

      const payload = (await response.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
        }>;
      };
      const rawText = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n") ?? "";
      const parsed = parseJsonObjectFromText(rawText);
      if (!parsed) {
        return {
          ...fallback,
          warning: "Gemini vision output did not parse as JSON; fallback metadata applied.",
          model
        };
      }

      const caption =
        typeof parsed.caption === "string" && parsed.caption.trim()
          ? sanitizeDeclarativeCopy(parsed.caption, 220)
          : fallback.caption;
      const altText =
        typeof parsed.altText === "string" && parsed.altText.trim()
          ? sanitizeDeclarativeCopy(parsed.altText, 140)
          : fallback.altText;
      const tags = [...new Set(toStringArray(parsed.tags).map((tag) => tag.toLowerCase()).slice(0, 14))];
      const entities = uniqueStrings(
        toStringArray(parsed.entities).map((entity) => sanitizeEntityLabel(entity, 80)).filter(Boolean),
        16
      );
      const sceneType = typeof parsed.sceneType === "string" && parsed.sceneType.trim() ? parsed.sceneType.trim() : fallback.sceneType;
      const qualityScore = clamp(Math.round(toNumber(parsed.qualityScore, fallback.qualityScore)), 0, 100);
      const serviceRelevanceScore = clamp(
        Math.round(toNumber(parsed.serviceRelevanceScore, fallback.serviceRelevanceScore)),
        0,
        100
      );
      const moderationRiskRaw = typeof parsed.moderationRisk === "string" ? parsed.moderationRisk.toLowerCase().trim() : "low";
      const moderationRisk: VisionAssetMetadata["moderationRisk"] =
        moderationRiskRaw === "high" || moderationRiskRaw === "medium" ? moderationRiskRaw : "low";
      const isSafe = parsed.isSafe === false ? false : moderationRisk !== "high";
      const isRelevant = parsed.isRelevant === false ? false : serviceRelevanceScore >= 35;
      const rejectionReasons = uniqueStrings(
        toStringArray(parsed.rejectionReasons).map((reason) => sanitizeDeclarativeCopy(reason, 140)).filter(Boolean),
        6
      );

      return {
        caption,
        altText,
        tags: tags.length ? tags : fallback.tags,
        entities: entities.length ? entities : fallback.entities,
        sceneType,
        qualityScore,
        isSafe,
        isRelevant,
        moderationRisk,
        serviceRelevanceScore,
        rejectionReasons,
        model
      };
    } catch (error) {
      return {
        ...fallback,
        warning: error instanceof Error ? error.message : String(error),
        model
      };
    }
  }

  private async renderEnhancedVariantBuffer(input: {
    sourceBuffer: Buffer;
    variantType: MediaFloodUploadCandidate["variantType"];
  }): Promise<{
    buffer: Buffer;
    mimeType: "image/jpeg";
    width: number;
    height: number;
    isPanoramaSource: boolean;
  }> {
    const base = sharp(input.sourceBuffer, { failOn: "none" }).rotate();
    const metadata = await base.metadata();
    const sourceWidth = metadata.width ?? 0;
    const sourceHeight = metadata.height ?? 0;
    if (!sourceWidth || !sourceHeight) {
      throw new Error("Source image dimensions are invalid for media derivative generation.");
    }
    const isPanoramaSource = sourceWidth / Math.max(sourceHeight, 1) >= 1.8;

    let targetWidth = 1600;
    let targetHeight = 1200;
    switch (input.variantType) {
      case "team_photo":
        targetWidth = 1200;
        targetHeight = 1200;
        break;
      case "story_vertical":
        targetWidth = 1080;
        targetHeight = 1920;
        break;
      case "virtual_tour_360":
        targetWidth = 2048;
        targetHeight = 1024;
        break;
      default:
        targetWidth = 1600;
        targetHeight = 1200;
        break;
    }

    const buffer = await sharp(input.sourceBuffer, { failOn: "none" })
      .rotate()
      .resize({
        width: targetWidth,
        height: targetHeight,
        fit: "cover",
        position: input.variantType === "story_vertical" ? "attention" : "center"
      })
      .modulate({
        saturation: 1.06,
        brightness: 1.03
      })
      .sharpen({
        sigma: 0.8
      })
      .withMetadata()
      .jpeg({
        quality: 86,
        mozjpeg: true,
        chromaSubsampling: "4:4:4"
      })
      .toBuffer();

    return {
      buffer,
      mimeType: "image/jpeg",
      width: targetWidth,
      height: targetHeight,
      isPanoramaSource
    };
  }

  private resolveMediaFloodStorageBucket(input: {
    context: RunContext;
    payload: Record<string, unknown>;
    settingsMetadata: Record<string, unknown>;
    mediaFloodMetadata: Record<string, unknown>;
  }): string | null {
    const fromPayload = typeof input.payload.storageBucket === "string" ? input.payload.storageBucket.trim() : "";
    if (fromPayload) {
      return fromPayload;
    }
    const fromMediaMeta =
      typeof input.mediaFloodMetadata.storageBucket === "string" ? input.mediaFloodMetadata.storageBucket.trim() : "";
    if (fromMediaMeta) {
      return fromMediaMeta;
    }
    const fromSettingsMeta =
      typeof input.settingsMetadata.mediaFloodStorageBucket === "string"
        ? input.settingsMetadata.mediaFloodStorageBucket.trim()
        : "";
    if (fromSettingsMeta) {
      return fromSettingsMeta;
    }
    return input.context.mediaAssets[0]?.storageBucket ?? null;
  }

  private async uploadProcessedMediaVariant(input: {
    bucket: string;
    clientId: string;
    actionId: string;
    locationId: string;
    naturalFileName: string;
    buffer: Buffer;
    mimeType: string;
  }): Promise<{ mediaUrl: string; storagePath: string }> {
    if (!isSupabaseConfigured()) {
      throw new Error("Supabase is not configured for processed media uploads");
    }

    const supabase = getSupabaseServiceClient();
    const ext = extensionFromMimeType(input.mimeType);
    const baseName = sanitizeStorageSegment(input.naturalFileName.replace(/\.[a-z0-9]+$/i, ""));
    const fileName = `${baseName || "media"}-${Date.now()}.${ext}`;
    const day = new Date().toISOString().slice(0, 10);
    const storagePath = [
      "processed",
      "media-flood",
      day,
      sanitizeStorageSegment(input.clientId),
      sanitizeStorageSegment(input.locationId),
      sanitizeStorageSegment(input.actionId),
      fileName
    ]
      .filter(Boolean)
      .join("/");

    const { error: uploadError } = await supabase.storage.from(input.bucket).upload(storagePath, input.buffer, {
      contentType: input.mimeType,
      cacheControl: "3600",
      upsert: false
    });
    if (uploadError) {
      throw new Error(uploadError.message);
    }

    const { data: signed, error: signedError } = await supabase.storage.from(input.bucket).createSignedUrl(storagePath, 60 * 60 * 24 * 14);
    if (signedError || !signed?.signedUrl) {
      throw new Error(signedError?.message ?? "Unable to create signed URL for processed media.");
    }

    const mediaUrl = normalizeHttpUrl(signed.signedUrl);
    if (!mediaUrl) {
      throw new Error("Generated signed URL for processed media is invalid.");
    }

    return {
      mediaUrl,
      storagePath
    };
  }

  private deriveMediaSaturationConfig(input: {
    payload: Record<string, unknown>;
    settingsMetadata: Record<string, unknown>;
    mediaFloodMetadata: Record<string, unknown>;
    targetAssets: number;
    batchSize: number;
    cooldownMs: number;
    includeStories: boolean;
    includeVideos: boolean;
    includeVirtualTours: boolean;
  }): {
    protocolMode: "standard" | "72h_saturation";
    stage: "day1" | "day2" | "day3_7";
    targetAssets: number;
    batchSize: number;
    cooldownMs: number;
    includeStories: boolean;
    includeVideos: boolean;
    includeVirtualTours: boolean;
    createFollowUpSchedule: boolean;
    variantPriority: MediaFloodUploadCandidate["variantType"][];
  } {
    const protocolModeRaw =
      typeof input.payload.protocolMode === "string"
        ? input.payload.protocolMode.toLowerCase().trim()
        : typeof input.mediaFloodMetadata.protocolMode === "string"
          ? String(input.mediaFloodMetadata.protocolMode).toLowerCase().trim()
          : typeof input.settingsMetadata.mediaFloodProtocolMode === "string"
            ? String(input.settingsMetadata.mediaFloodProtocolMode).toLowerCase().trim()
            : "72h_saturation";
    const protocolMode: "standard" | "72h_saturation" =
      protocolModeRaw === "72h_saturation" || protocolModeRaw === "72h" ? "72h_saturation" : "standard";
    const stageRaw =
      typeof input.payload.protocolStage === "string" ? input.payload.protocolStage.toLowerCase().trim() : "day1";
    const stage: "day1" | "day2" | "day3_7" =
      stageRaw === "day2" ? "day2" : stageRaw === "day3_7" || stageRaw === "day3-7" ? "day3_7" : "day1";
    const createFollowUpSchedule = input.payload.createFollowUpSchedule !== false;

    if (protocolMode === "standard") {
      return {
        protocolMode,
        stage,
        targetAssets: input.targetAssets,
        batchSize: input.batchSize,
        cooldownMs: input.cooldownMs,
        includeStories: input.includeStories,
        includeVideos: input.includeVideos,
        includeVirtualTours: input.includeVirtualTours,
        createFollowUpSchedule,
        variantPriority: ["action_shot", "team_photo", "story_vertical", "virtual_tour_360", "video_story", "video_original"]
      };
    }

    if (stage === "day2") {
      return {
        protocolMode,
        stage,
        targetAssets: clamp(Math.round(toNumber(input.payload.targetAssets, 4)), 2, 20),
        batchSize: clamp(Math.round(toNumber(input.payload.batchSize, 3)), 1, 10),
        cooldownMs: clamp(Math.round(toNumber(input.payload.cooldownMs, 1400)), 250, 8000),
        includeStories: true,
        includeVideos: true,
        includeVirtualTours: true,
        createFollowUpSchedule: false,
        variantPriority: ["virtual_tour_360", "video_story", "video_original", "story_vertical", "action_shot", "team_photo"]
      };
    }

    if (stage === "day3_7") {
      return {
        protocolMode,
        stage,
        targetAssets: clamp(Math.round(toNumber(input.payload.targetAssets, 5)), 3, 20),
        batchSize: clamp(Math.round(toNumber(input.payload.batchSize, 4)), 1, 12),
        cooldownMs: clamp(Math.round(toNumber(input.payload.cooldownMs, 1100)), 250, 8000),
        includeStories: input.includeStories,
        includeVideos: input.includeVideos,
        includeVirtualTours: input.includeVirtualTours,
        createFollowUpSchedule: false,
        variantPriority: ["action_shot", "story_vertical", "team_photo", "video_story", "video_original", "virtual_tour_360"]
      };
    }

    return {
      protocolMode,
      stage: "day1",
      targetAssets: clamp(Math.round(toNumber(input.payload.targetAssets, 5)), 3, 25),
      batchSize: clamp(Math.round(toNumber(input.payload.batchSize, 3)), 1, 10),
      cooldownMs: clamp(Math.round(toNumber(input.payload.cooldownMs, 900)), 250, 8000),
      includeStories: input.includeStories,
      includeVideos: input.includeVideos,
      includeVirtualTours: input.includeVirtualTours,
      createFollowUpSchedule,
      variantPriority: ["team_photo", "action_shot", "story_vertical", "video_story", "video_original", "virtual_tour_360"]
    };
  }

  private prioritizeMediaCandidates(
    candidates: MediaFloodUploadCandidate[],
    variantPriority: MediaFloodUploadCandidate["variantType"][]
  ): MediaFloodUploadCandidate[] {
    const index = new Map<string, number>();
    variantPriority.forEach((variant, position) => {
      index.set(variant, position);
    });
    return [...candidates].sort((a, b) => {
      const aPriority = index.get(a.variantType) ?? 999;
      const bPriority = index.get(b.variantType) ?? 999;
      if (aPriority !== bPriority) {
        return aPriority - bPriority;
      }
      const aEntityWeight = a.tags.length;
      const bEntityWeight = b.tags.length;
      return bEntityWeight - aEntityWeight;
    });
  }

  private async scheduleMediaSaturationFollowUps(input: {
    action: BlitzAction;
    context: RunContext;
    includeStories: boolean;
    includeVideos: boolean;
    includeVirtualTours: boolean;
    includeGeoTags: boolean;
    enableVision: boolean;
  }): Promise<Array<Record<string, unknown>>> {
    const now = new Date();
    const scheduled: Array<Record<string, unknown>> = [];
    const organizationId = input.action.organizationId ?? input.context.connection.organizationId;
    const clientId = input.action.clientId ?? input.context.connection.clientId;

    const enqueue = async (stage: "day2" | "day3_7", dayOffset: number, targetAssets: number, batchSize: number) => {
      const scheduledFor = parseRelativeWindow(now, `+${dayOffset}d`, `${input.action.id}:${stage}:${dayOffset}`);
      const actionPayload = {
        objective: "media_derivative_batch_upload",
        protocolMode: "72h_saturation",
        protocolStage: stage,
        createFollowUpSchedule: false,
        targetAssets,
        batchSize,
        includeStories: input.includeStories,
        includeVideos: input.includeVideos,
        includeVirtualTours: input.includeVirtualTours,
        includeGeoTags: input.includeGeoTags,
        enableVision: input.enableVision
      };
      await this.deps.repository.createContentArtifact({
        organizationId,
        clientId,
        runId: input.action.runId,
        phase: "media",
        channel: "gbp_media_saturation",
        title: `Media Saturation ${stage.toUpperCase()} (D+${dayOffset})`,
        body: `Scheduled media saturation stage ${stage} for day offset ${dayOffset}.`,
        status: "scheduled",
        scheduledFor,
        metadata: {
          source: "media_saturation_protocol",
          dispatchActionType: "media_upload",
          actionPayload,
          scheduledByActionId: input.action.id
        }
      });
      scheduled.push({
        stage,
        dayOffset,
        scheduledFor,
        targetAssets,
        batchSize
      });
    };

    await enqueue("day2", 1, 4, 3);
    await enqueue("day3_7", 2, 4, 3);
    await enqueue("day3_7", 3, 5, 4);
    await enqueue("day3_7", 4, 4, 3);
    await enqueue("day3_7", 5, 5, 4);
    await enqueue("day3_7", 6, 4, 3);

    return scheduled;
  }

  private async executeMediaUpload(input: {
    action: BlitzAction;
    context: RunContext;
  }): Promise<Record<string, unknown>> {
    const objective =
      typeof input.action.payload.objective === "string" ? input.action.payload.objective : "media_derivative_batch_upload";
    const settingsMetadata = asRecord(input.context.settings.metadata);
    const mediaFloodMetadata = asRecord(settingsMetadata.mediaFlood);

    const selectedAssetIds = new Set(input.context.settings.photoAssetIds);
    const allowedAssets = input.context.mediaAssets.filter((asset) => {
      if (!asset.isAllowedForPosts) {
        return false;
      }
      if (selectedAssetIds.size > 0 && !selectedAssetIds.has(asset.id)) {
        return false;
      }
      return true;
    });
    const sitemapUrls = await this.loadSitemapUrls(input.context.settings.sitemapUrl);
    const externalUrls = [...new Set(
      [...input.context.settings.photoAssetUrls, ...toStringArray(input.action.payload.mediaUrls)]
        .map((value) => normalizeHttpUrl(value))
        .filter((value): value is string => Boolean(value))
    )];

    if (!allowedAssets.length && !externalUrls.length) {
      throw new Error(
        "No media sources found. Upload client media assets or supply external media URLs before running media flood."
      );
    }

    const resolveBoolean = (value: unknown, fallback: boolean): boolean =>
      typeof value === "boolean" ? value : fallback;

    const configuredTargetAssets = clamp(
      Math.round(
        toNumber(
          input.action.payload.targetAssets,
          toNumber(mediaFloodMetadata.targetAssets, toNumber(settingsMetadata.mediaFloodTargetAssets, 50))
        )
      ),
      5,
      150
    );
    const configuredBatchSize = clamp(
      Math.round(toNumber(input.action.payload.batchSize, toNumber(mediaFloodMetadata.batchSize, 12))),
      1,
      30
    );
    const configuredCooldownMs = clamp(
      Math.round(toNumber(input.action.payload.cooldownMs, toNumber(mediaFloodMetadata.cooldownMs, 350))),
      50,
      5000
    );
    const maxPerLocation = clamp(
      Math.round(toNumber(input.action.payload.maxPerLocation, toNumber(mediaFloodMetadata.maxPerLocation, 80))),
      1,
      100
    );
    const includeGeoTags = resolveBoolean(input.action.payload.includeGeoTags, resolveBoolean(mediaFloodMetadata.includeGeoTags, true));
    const configuredIncludeStories = resolveBoolean(
      input.action.payload.includeStories,
      resolveBoolean(mediaFloodMetadata.includeStories, true)
    );
    const configuredIncludeVideos = resolveBoolean(
      input.action.payload.includeVideos,
      resolveBoolean(mediaFloodMetadata.includeVideos, true)
    );
    const configuredIncludeVirtualTours = resolveBoolean(
      input.action.payload.includeVirtualTours,
      resolveBoolean(mediaFloodMetadata.includeVirtualTours, true)
    );
    const enableVision = resolveBoolean(input.action.payload.enableVision, resolveBoolean(mediaFloodMetadata.enableVision, true));
    const minVisionQualityScore = clamp(
      Math.round(toNumber(input.action.payload.minVisionQualityScore, toNumber(mediaFloodMetadata.minVisionQualityScore, 35))),
      0,
      100
    );
    const minServiceRelevanceScore = clamp(
      Math.round(
        toNumber(input.action.payload.minServiceRelevanceScore, toNumber(mediaFloodMetadata.minServiceRelevanceScore, 45))
      ),
      0,
      100
    );
    const allowMediumModerationRisk = resolveBoolean(
      input.action.payload.allowMediumModerationRisk,
      resolveBoolean(mediaFloodMetadata.allowMediumModerationRisk, false)
    );
    const saturation = this.deriveMediaSaturationConfig({
      payload: input.action.payload,
      settingsMetadata,
      mediaFloodMetadata,
      targetAssets: configuredTargetAssets,
      batchSize: configuredBatchSize,
      cooldownMs: configuredCooldownMs,
      includeStories: configuredIncludeStories,
      includeVideos: configuredIncludeVideos,
      includeVirtualTours: configuredIncludeVirtualTours
    });
    const targetAssets = saturation.targetAssets;
    const batchSize = saturation.batchSize;
    const cooldownMs = saturation.cooldownMs;
    const includeStories = saturation.includeStories;
    const includeVideos = saturation.includeVideos;
    const includeVirtualTours = saturation.includeVirtualTours;
    const storageBucket = this.resolveMediaFloodStorageBucket({
      context: input.context,
      payload: input.action.payload,
      settingsMetadata,
      mediaFloodMetadata
    });

    const warnings = [...input.context.warnings];
    if (!storageBucket) {
      warnings.push(
        "No storage bucket configured for media derivatives. Media flood will use direct source URLs only and skip generated variants."
      );
    }

    const snapshots = new Map<string, LocationRichSnapshot>();
    for (const location of input.context.locations) {
      try {
        const snapshot = await this.fetchLocationSnapshot({
          context: input.context,
          location
        });
        snapshots.set(location.locationName, snapshot);
      } catch (error) {
        warnings.push(
          `${location.locationName}: failed to load location snapshot for media geo-tagging (${error instanceof Error ? error.message : String(error)})`
        );
      }
    }
    const firstLocation = input.context.locations[0];
    const firstSnapshot = firstLocation ? snapshots.get(firstLocation.locationName) : null;
    const firstCityState = firstSnapshot ? formatCityState(firstSnapshot.storefrontAddress) : null;
    const firstTitle = firstSnapshot?.title ?? firstLocation?.title ?? "Local Business";

    const poolLimit = clamp(targetAssets * 3, 20, 300);
    const candidates: MediaFloodUploadCandidate[] = [];
    const sourceFailures: Array<Record<string, unknown>> = [];
    const filteredOut: Array<Record<string, unknown>> = [];

    for (const asset of allowedAssets) {
      if (candidates.length >= poolLimit) {
        break;
      }

      const detectedMime = inferMediaMimeType({
        fileName: asset.fileName,
        mimeType: asset.mimeType,
        url: mediaUrlFromAsset(asset)
      });

      if (isVideoMimeType(detectedMime)) {
        if (!includeVideos) {
          continue;
        }
        const directUrl = await this.resolveDirectAssetMediaUrl(asset);
        if (!directUrl) {
          sourceFailures.push({
            sourceType: "client_bucket",
            sourceAssetId: asset.id,
            fileName: asset.fileName,
            error: "Unable to resolve direct media URL for video asset."
          });
          continue;
        }

        const fallback = this.buildFallbackVisionMetadata({
          locationTitle: firstTitle,
          variantType: "video_original",
          cityState: firstCityState,
          objectives: input.context.settings.objectives,
          tags: asset.tags
        });
        const baseGeo = {
          cityState: firstCityState,
          lat: firstSnapshot?.geo?.lat ?? null,
          lng: firstSnapshot?.geo?.lng ?? null
        };
        candidates.push({
          sourceAssetId: asset.id,
          sourceType: "client_bucket",
          variantType: "video_original",
          mediaFormat: "VIDEO",
          mimeType: detectedMime,
          mediaUrl: directUrl,
          naturalFileName: this.buildMediaFloodNaturalFileName({
            locationTitle: firstTitle,
            cityState: firstCityState,
            variantType: "video_original",
            entityHints: fallback.entities,
            ordinal: candidates.length + 1,
            extension: extensionFromMimeType(detectedMime)
          }),
          caption: fallback.caption,
          altText: fallback.altText,
          tags: fallback.tags,
          locationCategory: this.mediaCategoryForVariant("video_original", "VIDEO"),
          geoTag: baseGeo,
          storagePath: null
        });
        if (includeStories && candidates.length < poolLimit) {
          const storyCaption = sanitizeDeclarativeCopy(
            `${fallback.caption} Need same-day service support? Call now for availability.`,
            220
          );
          candidates.push({
            sourceAssetId: asset.id,
            sourceType: "client_bucket",
            variantType: "video_story",
            mediaFormat: "VIDEO",
            mimeType: detectedMime,
            mediaUrl: directUrl,
            naturalFileName: this.buildMediaFloodNaturalFileName({
              locationTitle: firstTitle,
              cityState: firstCityState,
              variantType: "video_story",
              entityHints: fallback.entities,
              ordinal: candidates.length + 1,
              extension: extensionFromMimeType(detectedMime)
            }),
            caption: storyCaption,
            altText: fallback.altText,
            tags: [...new Set([...fallback.tags, "story", "cta"])].slice(0, 16),
            locationCategory: this.mediaCategoryForVariant("video_story", "VIDEO"),
            geoTag: baseGeo,
            storagePath: null
          });
        }
        continue;
      }

      if (!isImageMimeType(detectedMime)) {
        sourceFailures.push({
          sourceType: "client_bucket",
          sourceAssetId: asset.id,
          fileName: asset.fileName,
          error: `Unsupported asset MIME type for media flood: ${detectedMime}`
        });
        continue;
      }

      try {
        const sourceBuffer = await this.downloadAssetBuffer(asset);
        const sourceMeta = await sharp(sourceBuffer, { failOn: "none" }).metadata();
        const sourceRatio =
          sourceMeta.width && sourceMeta.height ? sourceMeta.width / Math.max(sourceMeta.height, 1) : 1;
        const variantPlan: MediaFloodUploadCandidate["variantType"][] = ["action_shot", "team_photo"];
        if (includeStories) {
          variantPlan.push("story_vertical");
        }
        if (includeVirtualTours && sourceRatio >= 1.8) {
          variantPlan.push("virtual_tour_360");
        }

        for (const variantType of variantPlan) {
          if (candidates.length >= poolLimit) {
            break;
          }

          const rendered = await this.renderEnhancedVariantBuffer({
            sourceBuffer,
            variantType
          });

          const vision = await this.generateVisionMetadataForImage({
            imageBuffer: rendered.buffer,
            mimeType: rendered.mimeType,
            locationTitle: firstTitle,
            variantType,
            objectives: input.context.settings.objectives,
            cityState: firstCityState,
            fallbackTags: asset.tags,
            enableVision
          });
          if (vision.warning) {
            warnings.push(`${asset.fileName}: ${vision.warning}`);
          }
          const moderationRiskTooHigh =
            vision.moderationRisk === "high" || (!allowMediumModerationRisk && vision.moderationRisk === "medium");
          const relevanceTooLow = vision.serviceRelevanceScore < minServiceRelevanceScore;
          const qualityTooLow = vision.qualityScore < minVisionQualityScore;
          if (!vision.isSafe || !vision.isRelevant || moderationRiskTooHigh || relevanceTooLow || qualityTooLow) {
            filteredOut.push({
              sourceType: "client_bucket",
              sourceAssetId: asset.id,
              fileName: asset.fileName,
              variantType,
              moderationRisk: vision.moderationRisk,
              qualityScore: vision.qualityScore,
              serviceRelevanceScore: vision.serviceRelevanceScore,
              rejectionReasons: vision.rejectionReasons ?? [],
              ruleFlags: {
                isSafe: vision.isSafe,
                isRelevant: vision.isRelevant,
                moderationRiskTooHigh,
                relevanceTooLow,
                qualityTooLow
              }
            });
            continue;
          }

          let mediaUrl: string | null = null;
          let storagePath: string | null = null;
          const naturalFileName = this.buildMediaFloodNaturalFileName({
            locationTitle: firstTitle,
            cityState: firstCityState,
            variantType,
            entityHints: vision.entities,
            ordinal: candidates.length + 1,
            extension: "jpg"
          });

          if (storageBucket && isSupabaseConfigured()) {
            try {
              const uploaded = await this.uploadProcessedMediaVariant({
                bucket: storageBucket,
                clientId: input.action.clientId ?? input.context.connection.clientId,
                actionId: input.action.id,
                locationId: firstLocation?.locationId ?? "default",
                naturalFileName,
                buffer: rendered.buffer,
                mimeType: rendered.mimeType
              });
              mediaUrl = uploaded.mediaUrl;
              storagePath = uploaded.storagePath;
            } catch (error) {
              warnings.push(
                `${asset.fileName}/${variantType}: failed to upload processed derivative (${error instanceof Error ? error.message : String(error)})`
              );
            }
          }

          if (!mediaUrl) {
            mediaUrl = await this.resolveDirectAssetMediaUrl(asset);
          }
          if (!mediaUrl) {
            sourceFailures.push({
              sourceType: "client_bucket",
              sourceAssetId: asset.id,
              fileName: asset.fileName,
              variantType,
              error: "Unable to resolve a publishable media URL for processed image."
            });
            continue;
          }

          candidates.push({
            sourceAssetId: asset.id,
            sourceType: "client_bucket",
            variantType,
            mediaFormat: "PHOTO",
            mimeType: rendered.mimeType,
            mediaUrl,
            naturalFileName,
            caption: vision.caption,
            altText: vision.altText,
            tags: [...new Set([...(asset.tags ?? []), ...(vision.tags ?? []), ...vision.entities])].slice(0, 16),
            locationCategory: this.mediaCategoryForVariant(variantType, "PHOTO"),
            geoTag: {
              cityState: firstCityState,
              lat: firstSnapshot?.geo?.lat ?? null,
              lng: firstSnapshot?.geo?.lng ?? null
            },
            storagePath
          });
        }
      } catch (error) {
        sourceFailures.push({
          sourceType: "client_bucket",
          sourceAssetId: asset.id,
          fileName: asset.fileName,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    for (const sourceUrl of externalUrls) {
      if (candidates.length >= poolLimit) {
        break;
      }

      const guessedMime = inferMediaMimeType({ url: sourceUrl });
      if (isVideoMimeType(guessedMime)) {
        if (!includeVideos) {
          continue;
        }
        const fallback = this.buildFallbackVisionMetadata({
          locationTitle: firstTitle,
          variantType: "video_original",
          cityState: firstCityState,
          objectives: input.context.settings.objectives,
          tags: ["external"]
        });
        const baseGeo = {
          cityState: firstCityState,
          lat: firstSnapshot?.geo?.lat ?? null,
          lng: firstSnapshot?.geo?.lng ?? null
        };
        candidates.push({
          sourceAssetId: null,
          sourceType: "external_url",
          variantType: "video_original",
          mediaFormat: "VIDEO",
          mimeType: guessedMime,
          mediaUrl: sourceUrl,
          naturalFileName: this.buildMediaFloodNaturalFileName({
            locationTitle: firstTitle,
            cityState: firstCityState,
            variantType: "video_original",
            entityHints: fallback.entities,
            ordinal: candidates.length + 1,
            extension: extensionFromMimeType(guessedMime)
          }),
          caption: fallback.caption,
          altText: fallback.altText,
          tags: fallback.tags,
          locationCategory: this.mediaCategoryForVariant("video_original", "VIDEO"),
          geoTag: baseGeo,
          storagePath: null
        });
        if (includeStories && candidates.length < poolLimit) {
          const storyCaption = sanitizeDeclarativeCopy(
            `${fallback.caption} Need same-day service support? Call now for availability.`,
            220
          );
          candidates.push({
            sourceAssetId: null,
            sourceType: "external_url",
            variantType: "video_story",
            mediaFormat: "VIDEO",
            mimeType: guessedMime,
            mediaUrl: sourceUrl,
            naturalFileName: this.buildMediaFloodNaturalFileName({
              locationTitle: firstTitle,
              cityState: firstCityState,
              variantType: "video_story",
              entityHints: fallback.entities,
              ordinal: candidates.length + 1,
              extension: extensionFromMimeType(guessedMime)
            }),
            caption: storyCaption,
            altText: fallback.altText,
            tags: [...new Set([...fallback.tags, "story", "cta"])].slice(0, 16),
            locationCategory: this.mediaCategoryForVariant("video_story", "VIDEO"),
            geoTag: baseGeo,
            storagePath: null
          });
        }
        continue;
      }

      try {
        const binary = await this.fetchBinaryWithTimeout(sourceUrl, 20000);
        const detectedMime = inferMediaMimeType({
          url: sourceUrl,
          mimeType: binary.contentType
        });
        if (!isImageMimeType(detectedMime)) {
          sourceFailures.push({
            sourceType: "external_url",
            sourceUrl,
            error: `External URL is not an image/video asset (${detectedMime}).`
          });
          continue;
        }

        const sourceBuffer = binary.buffer;
        const sourceMeta = await sharp(sourceBuffer, { failOn: "none" }).metadata();
        const sourceRatio =
          sourceMeta.width && sourceMeta.height ? sourceMeta.width / Math.max(sourceMeta.height, 1) : 1;
        const variantPlan: MediaFloodUploadCandidate["variantType"][] = ["action_shot", "team_photo"];
        if (includeStories) {
          variantPlan.push("story_vertical");
        }
        if (includeVirtualTours && sourceRatio >= 1.8) {
          variantPlan.push("virtual_tour_360");
        }

        for (const variantType of variantPlan) {
          if (candidates.length >= poolLimit) {
            break;
          }

          const rendered = await this.renderEnhancedVariantBuffer({
            sourceBuffer,
            variantType
          });
          const vision = await this.generateVisionMetadataForImage({
            imageBuffer: rendered.buffer,
            mimeType: rendered.mimeType,
            locationTitle: firstTitle,
            variantType,
            objectives: input.context.settings.objectives,
            cityState: firstCityState,
            fallbackTags: ["external"],
            enableVision
          });
          if (vision.warning) {
            warnings.push(`${sourceUrl}: ${vision.warning}`);
          }
          const moderationRiskTooHigh =
            vision.moderationRisk === "high" || (!allowMediumModerationRisk && vision.moderationRisk === "medium");
          const relevanceTooLow = vision.serviceRelevanceScore < minServiceRelevanceScore;
          const qualityTooLow = vision.qualityScore < minVisionQualityScore;
          if (!vision.isSafe || !vision.isRelevant || moderationRiskTooHigh || relevanceTooLow || qualityTooLow) {
            filteredOut.push({
              sourceType: "external_url",
              sourceUrl,
              variantType,
              moderationRisk: vision.moderationRisk,
              qualityScore: vision.qualityScore,
              serviceRelevanceScore: vision.serviceRelevanceScore,
              rejectionReasons: vision.rejectionReasons ?? [],
              ruleFlags: {
                isSafe: vision.isSafe,
                isRelevant: vision.isRelevant,
                moderationRiskTooHigh,
                relevanceTooLow,
                qualityTooLow
              }
            });
            continue;
          }

          const naturalFileName = this.buildMediaFloodNaturalFileName({
            locationTitle: firstTitle,
            cityState: firstCityState,
            variantType,
            entityHints: vision.entities,
            ordinal: candidates.length + 1,
            extension: "jpg"
          });

          let mediaUrl: string | null = sourceUrl;
          let storagePath: string | null = null;
          if (storageBucket && isSupabaseConfigured()) {
            try {
              const uploaded = await this.uploadProcessedMediaVariant({
                bucket: storageBucket,
                clientId: input.action.clientId ?? input.context.connection.clientId,
                actionId: input.action.id,
                locationId: firstLocation?.locationId ?? "default",
                naturalFileName,
                buffer: rendered.buffer,
                mimeType: rendered.mimeType
              });
              mediaUrl = uploaded.mediaUrl;
              storagePath = uploaded.storagePath;
            } catch (error) {
              warnings.push(
                `${sourceUrl}/${variantType}: failed to upload processed derivative (${error instanceof Error ? error.message : String(error)})`
              );
            }
          }

          if (!mediaUrl) {
            sourceFailures.push({
              sourceType: "external_url",
              sourceUrl,
              variantType,
              error: "Unable to resolve publishable URL for external media variant."
            });
            continue;
          }

          candidates.push({
            sourceAssetId: null,
            sourceType: "external_url",
            variantType,
            mediaFormat: "PHOTO",
            mimeType: rendered.mimeType,
            mediaUrl,
            naturalFileName,
            caption: vision.caption,
            altText: vision.altText,
            tags: [...new Set(["external", ...(vision.tags ?? []), ...vision.entities])].slice(0, 16),
            locationCategory: this.mediaCategoryForVariant(variantType, "PHOTO"),
            geoTag: {
              cityState: firstCityState,
              lat: firstSnapshot?.geo?.lat ?? null,
              lng: firstSnapshot?.geo?.lng ?? null
            },
            storagePath
          });
        }
      } catch (error) {
        sourceFailures.push({
          sourceType: "external_url",
          sourceUrl,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const prioritizedCandidates = this.prioritizeMediaCandidates(candidates, saturation.variantPriority);

    if (!prioritizedCandidates.length) {
      return {
        objective,
        status: "no_candidates_generated",
        locationCount: input.context.locations.length,
        sourceAssets: {
          clientBucketAssets: allowedAssets.length,
          externalUrls: externalUrls.length
        },
        protocol: {
          mode: saturation.protocolMode,
          stage: saturation.stage
        },
        filteredOutCount: filteredOut.length,
        filteredOut,
        sourceFailures,
        warnings
      };
    }

    const existingUrlSets = new Map<string, Set<string>>();
    const existingMediaCount = new Map<string, number>();
    for (const location of input.context.locations) {
      try {
        const existing = await input.context.client.listLocationMedia(location.accountId, location.locationId, 100);
        const sourceSet = new Set(
          existing
            .map((item) => normalizeHttpUrl(item.sourceUrl ?? item.googleUrl ?? null))
            .filter((value): value is string => Boolean(value))
            .map((value) => value.toLowerCase())
        );
        existingUrlSets.set(location.locationName, sourceSet);
        existingMediaCount.set(location.locationName, existing.length);
      } catch (error) {
        warnings.push(
          `${location.locationName}: failed to list existing GBP media (${error instanceof Error ? error.message : String(error)}).`
        );
        existingUrlSets.set(location.locationName, new Set());
        existingMediaCount.set(location.locationName, 0);
      }
    }

    const plannedByLocation = new Map<string, Set<string>>();
    const queue: Array<{ location: ResolvedLocation; candidate: MediaFloodUploadCandidate }> = [];
    let skippedExisting = 0;
    let skippedDuplicate = 0;
    let skippedCapacity = 0;

    let pointer = 0;
    let guard = 0;
    const guardLimit = targetAssets * 40;
    while (queue.length < targetAssets && guard < guardLimit) {
      const location = input.context.locations[pointer % input.context.locations.length];
      const candidate = prioritizedCandidates[pointer % prioritizedCandidates.length];
      pointer += 1;
      guard += 1;

      const normalizedUrl = normalizeHttpUrl(candidate.mediaUrl);
      if (!normalizedUrl) {
        continue;
      }
      const key = normalizedUrl.toLowerCase();
      const dedupeKey = candidate.mediaFormat === "VIDEO" ? `${key}|${candidate.variantType}` : key;
      const existing = existingUrlSets.get(location.locationName) ?? new Set();
      const planned = plannedByLocation.get(location.locationName) ?? new Set();
      const alreadyCount = existingMediaCount.get(location.locationName) ?? existing.size;
      if (alreadyCount + planned.size >= maxPerLocation) {
        skippedCapacity += 1;
        continue;
      }
      if (existing.has(key)) {
        skippedExisting += 1;
        continue;
      }
      if (planned.has(dedupeKey)) {
        skippedDuplicate += 1;
        continue;
      }

      const locationSnapshot = snapshots.get(location.locationName);
      const cityState = locationSnapshot ? formatCityState(locationSnapshot.storefrontAddress) : null;
      const geoTag = includeGeoTags
        ? {
            cityState,
            lat: locationSnapshot?.geo?.lat ?? null,
            lng: locationSnapshot?.geo?.lng ?? null
          }
        : {
            cityState: null,
            lat: null,
            lng: null
          };

      planned.add(dedupeKey);
      plannedByLocation.set(location.locationName, planned);
      queue.push({
        location,
        candidate: {
          ...candidate,
          caption: cityState ? `${candidate.caption} (${cityState})`.slice(0, 900) : candidate.caption.slice(0, 900),
          geoTag
        }
      });
    }

    if (!queue.length) {
      return {
        objective,
        status: "no_uploads_after_dedupe",
        locationCount: input.context.locations.length,
        generatedCandidateCount: prioritizedCandidates.length,
        requestedUploads: targetAssets,
        skippedExisting,
        skippedDuplicate,
        skippedCapacity,
        protocol: {
          mode: saturation.protocolMode,
          stage: saturation.stage
        },
        filteredOutCount: filteredOut.length,
        filteredOut,
        sourceFailures,
        warnings
      };
    }

    const uploaded: Array<Record<string, unknown>> = [];
    const failed: Array<Record<string, unknown>> = [];
    const batchSummaries: Array<Record<string, unknown>> = [];

    for (let batchStart = 0; batchStart < queue.length; batchStart += batchSize) {
      const batch = queue.slice(batchStart, batchStart + batchSize);
      let batchUploaded = 0;
      const batchFailed: Array<Record<string, unknown>> = [];

      for (const entry of batch) {
        try {
          let created: { name?: string; createTime?: string };
          try {
            created = await input.context.client.uploadLocationMedia({
              accountId: entry.location.accountId,
              locationId: entry.location.locationId,
              mediaFormat: entry.candidate.mediaFormat,
              sourceUrl: entry.candidate.mediaUrl,
              description: entry.candidate.caption,
              locationCategory: entry.candidate.locationCategory
            });
          } catch (error) {
            if (entry.candidate.mediaFormat !== "PHOTO") {
              throw error;
            }
            created = await input.context.client.uploadLocationMedia({
              accountId: entry.location.accountId,
              locationId: entry.location.locationId,
              mediaFormat: entry.candidate.mediaFormat,
              sourceUrl: entry.candidate.mediaUrl,
              description: entry.candidate.caption
            });
            warnings.push(
              `${entry.location.locationName}: media uploaded without category fallback for ${entry.candidate.variantType}`
            );
          }
          batchUploaded += 1;
          uploaded.push({
            locationName: entry.location.locationName,
            locationId: entry.location.locationId,
            variantType: entry.candidate.variantType,
            mediaFormat: entry.candidate.mediaFormat,
            sourceType: entry.candidate.sourceType,
            sourceAssetId: entry.candidate.sourceAssetId,
            sourceUrl: entry.candidate.mediaUrl,
            storagePath: entry.candidate.storagePath ?? null,
            caption: entry.candidate.caption,
            tags: entry.candidate.tags,
            geoTag: entry.candidate.geoTag,
            createdName: created.name ?? null,
            createdAt: created.createTime ?? nowIso()
          });
        } catch (error) {
          const failure = {
            locationName: entry.location.locationName,
            locationId: entry.location.locationId,
            variantType: entry.candidate.variantType,
            mediaFormat: entry.candidate.mediaFormat,
            sourceUrl: entry.candidate.mediaUrl,
            error: error instanceof Error ? error.message : String(error)
          };
          batchFailed.push(failure);
          failed.push(failure);
        }
        await sleep(cooldownMs + Math.floor(Math.random() * 250));
      }

      batchSummaries.push({
        batchIndex: Math.floor(batchStart / batchSize) + 1,
        size: batch.length,
        uploaded: batchUploaded,
        failed: batchFailed.length
      });

      if (batchStart + batchSize < queue.length) {
        await sleep(cooldownMs + Math.floor(Math.random() * 400));
      }
    }

    const uploadedByVariant = uploaded.reduce<Record<string, number>>((acc, row) => {
      const key = typeof row.variantType === "string" ? row.variantType : "unknown";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    let scheduledFollowUps: Array<Record<string, unknown>> = [];
    if (saturation.protocolMode === "72h_saturation" && saturation.stage === "day1" && saturation.createFollowUpSchedule) {
      try {
        scheduledFollowUps = await this.scheduleMediaSaturationFollowUps({
          action: input.action,
          context: input.context,
          includeStories,
          includeVideos,
          includeVirtualTours,
          includeGeoTags,
          enableVision
        });
      } catch (error) {
        warnings.push(
          `Failed to schedule media saturation follow-up stages: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    return {
      objective,
      status: failed.length ? (uploaded.length ? "partial_success" : "failed") : "completed",
      locationCount: input.context.locations.length,
      sourceAssets: {
        clientBucketAssets: allowedAssets.length,
        externalUrls: externalUrls.length
      },
      generatedCandidateCount: prioritizedCandidates.length,
      requestedUploads: targetAssets,
      queuedUploads: queue.length,
      uploadedCount: uploaded.length,
      failedCount: failed.length,
      uploadedByVariant,
      skippedExisting,
      skippedDuplicate,
      skippedCapacity,
      config: {
        batchSize,
        cooldownMs,
        maxPerLocation,
        includeGeoTags,
        includeStories,
        includeVideos,
        includeVirtualTours,
        enableVision,
        storageBucket: storageBucket ?? null,
        minVisionQualityScore,
        minServiceRelevanceScore,
        allowMediumModerationRisk,
        protocolMode: saturation.protocolMode,
        protocolStage: saturation.stage
      },
      filteredOutCount: filteredOut.length,
      filteredOut,
      scheduledFollowUps,
      batchSummaries,
      uploaded,
      failed,
      sourceFailures,
      warnings
    };
  }

  private async executeManualPostToolPublish(input: {
    action: BlitzAction;
    context: RunContext;
    sitemapUrls: string[];
    allowedAssets: ClientMediaAssetRecord[];
    ctaUrlFromPayload: string | null;
    mediaUrlFromPayload: string | null;
  }): Promise<Record<string, unknown>> {
    const payload = input.action.payload;
    const warnings: string[] = [];
    const locationId = typeof payload.locationId === "string" ? payload.locationId : null;
    const locationName = typeof payload.locationName === "string" ? payload.locationName : null;
    const location =
      input.context.locations.find((entry) => {
        if (locationId && entry.locationId === locationId) {
          return true;
        }
        if (locationName && entry.locationName === locationName) {
          return true;
        }
        return false;
      }) ?? input.context.locations[0];
    if (!location) {
      throw new Error("No GBP location available for manual post tool publish.");
    }

    const selectedAssetId = typeof payload.mediaAssetId === "string" ? payload.mediaAssetId : null;
    const selectedAssetFromPayload = selectedAssetId
      ? input.allowedAssets.find((asset) => asset.id === selectedAssetId) ?? null
      : null;
    if (selectedAssetId && !selectedAssetFromPayload) {
      warnings.push(`Configured media asset ${selectedAssetId} is unavailable. Post will publish text-only.`);
    }

    const selectedAsset =
      selectedAssetFromPayload ??
      (input.allowedAssets.length
        ? input.allowedAssets[hashStringToNumber(`${input.action.id}:manual-asset`) % input.allowedAssets.length]
        : null);
    if (!selectedAsset && !input.mediaUrlFromPayload) {
      warnings.push("No approved media assets found for this client. Publishing text-only.");
    }

    const landing = this.selectLandingUrl({
      action: input.action,
      context: input.context,
      location,
      index: 0,
      sitemapUrls: input.sitemapUrls
    });
    const tinyUrlResult = await this.createTinyUrl(landing.landingUrl);
    if (!tinyUrlResult.success && tinyUrlResult.error) {
      warnings.push(`TinyURL fallback used: ${tinyUrlResult.error}`);
    }
    const ctaUrl = input.ctaUrlFromPayload ?? tinyUrlResult.tinyUrl;
    const pageContext = await this.fetchLandingPageContext(landing.landingUrl);
    const snapshot = await this.fetchLocationSnapshot({ context: input.context, location });
    const competitors = await this.discoverTopCompetitors({
      snapshot,
      location,
      objectives: input.context.settings.objectives,
      maxResults: 5
    });
    const signalBundle = await this.buildTrendSignalBundle({
      location,
      snapshot,
      pageContext,
      sitemapUrls: input.sitemapUrls,
      objectives: input.context.settings.objectives,
      competitors
    });
    const suggestions = await this.generateLocationSemanticSuggestions({
      location,
      snapshot,
      competitors,
      objectives: input.context.settings.objectives,
      settings: input.context.settings,
      sitemapUrls: input.sitemapUrls
    });
    const qaPair = suggestions.qaPairs[0] ?? null;
    const systemMessage =
      typeof payload.systemMessage === "string" && payload.systemMessage.trim()
        ? payload.systemMessage.trim()
        : null;
    const toneOverride =
      typeof payload.toneOverride === "string" && payload.toneOverride.trim()
        ? payload.toneOverride.trim()
        : input.context.settings.tone;
    const archetype = buildBurstArchetypePlan(
      hashStringToNumber(`${input.action.id}:manual-archetype`) % 8,
      toStringArray(payload.archetypes)
    );
    const generatedCopy = await this.generatePostCopy({
      locationTitle: location.title ?? snapshot.title ?? "our business",
      objective: "manual_post_tool_publish",
      ordinal: 1,
      archetype,
      tone: toneOverride,
      wordRange: {
        min: input.context.settings.postWordCountMin,
        max: input.context.settings.postWordCountMax
      },
      landingUrl: landing.landingUrl,
      shortUrl: tinyUrlResult.tinyUrl,
      pageContext,
      objectives: input.context.settings.objectives,
      localTrendSignals: signalBundle.localTrendSignals,
      localQuestionIntents: signalBundle.localQuestionIntents,
      searchIntentSignals: signalBundle.searchIntentSignals,
      competitorCitationSignals: signalBundle.competitorCitationSignals,
      qaPair,
      ctaUrl,
      systemMessage
    });
    if (generatedCopy.warning) {
      warnings.push(generatedCopy.warning);
    }

    const summary = input.context.settings.eeatStructuredSnippetEnabled
      ? generatedCopy.snippet
      : buildPostSummary({
          locationTitle: location.title ?? "our business",
          objective: "manual_post_tool_publish",
          ordinal: 1,
          payload: input.action.payload
        });

    let mediaUrl: string | undefined = input.mediaUrlFromPayload ?? undefined;
    let processedStoragePath: string | null = null;
    let mediaGenerationError: string | null = null;
    if (!mediaUrl && selectedAsset) {
      const mediaResult = await this.generateQrOverlayMedia({
        asset: selectedAsset,
        clientId: input.action.clientId ?? input.context.connection.clientId,
        actionId: input.action.id,
        qrUrl: landing.landingUrl
      });
      mediaUrl = mediaResult.mediaUrl ?? undefined;
      processedStoragePath = mediaResult.processedStoragePath;
      mediaGenerationError = mediaResult.error;
      if (mediaGenerationError) {
        warnings.push(mediaGenerationError);
      }
    }

    const response = await input.context.client.publishLocalPost(location.accountId, location.locationId, {
      summary,
      topicType: "STANDARD",
      mediaUrl,
      ctaUrl
    });

    return {
      objective: "manual_post_tool_publish",
      status: "published",
      locationName: location.locationName,
      locationId: location.locationId,
      sourceLandingUrl: landing.landingUrl,
      tinyUrl: tinyUrlResult.tinyUrl,
      ctaUrl,
      mediaAssetId: selectedAsset?.id ?? null,
      mediaProcessedStoragePath: processedStoragePath,
      mediaGenerationError,
      contentProvider: generatedCopy.provider,
      contentModel: generatedCopy.model,
      postTitle: generatedCopy.title,
      postedSummary: summary,
      generatedLongForm: generatedCopy.longForm,
      wordCount: wordCount(generatedCopy.longForm),
      publishedPosts: [
        {
          name: response.name,
          accountId: location.accountId,
          locationId: location.locationId,
          locationName: location.locationName
        }
      ],
      warnings
    };
  }

  private async executePostPublish(input: {
    action: BlitzAction;
    context: RunContext;
    objective: string;
  }): Promise<Record<string, unknown>> {
    const configuredArchetypes = toStringArray(input.action.payload.archetypes);
    const minQaPairs = clamp(toNumber(input.action.payload.minQaPairs, 20), 20, 30);
    const maxQaPairs = clamp(toNumber(input.action.payload.maxQaPairs, 24), minQaPairs, 30);
    const geoContentMetadata = asRecord(asRecord(input.context.settings.metadata).geoContent);
    const qnaTarget = clamp(
      toNumber(input.action.payload.qnaTarget, toNumber(geoContentMetadata.qnaTarget, maxQaPairs)),
      minQaPairs,
      maxQaPairs
    );
    const enforcedPostsPerWeek = HARDCODED_POSTS_PER_WEEK;
    const enforcedPostWindows = buildHardcodedWeeklyPostWindows();
    const requireOperatorApproval =
      input.objective !== "publish_scheduled_artifact" && geoContentMetadata.requireOperatorApproval !== false;
    const ctaUrlFromPayload = normalizeHttpUrl(
      typeof input.action.payload.ctaUrl === "string" ? input.action.payload.ctaUrl : null
    );
    const mediaUrlFromPayload = normalizeHttpUrl(
      typeof input.action.payload.mediaUrl === "string" ? input.action.payload.mediaUrl : null
    );
    const selectedAssetIds = new Set(input.context.settings.photoAssetIds);
    const allowedAssets = input.context.mediaAssets.filter((asset) => {
      if (!asset.isAllowedForPosts) {
        return false;
      }
      if (selectedAssetIds.size > 0 && !selectedAssetIds.has(asset.id)) {
        return false;
      }
      return true;
    });
    const sitemapUrls = await this.loadSitemapUrls(input.context.settings.sitemapUrl);
    const uniqueAssetPool = [...allowedAssets].sort((left, right) => {
      const leftScore = hashStringToNumber(`${input.action.id}:${left.id}`);
      const rightScore = hashStringToNumber(`${input.action.id}:${right.id}`);
      return leftScore - rightScore;
    });
    const usedAssetIds = new Set<string>();
    const pickNextUniqueAsset = (): ClientMediaAssetRecord | null => {
      const next = uniqueAssetPool.find((asset) => !usedAssetIds.has(asset.id));
      if (!next) {
        return null;
      }
      usedAssetIds.add(next.id);
      return next;
    };
    const usedLandingUrls = new Set<string>();
    const resolveUniqueLandingUrl = (location: ResolvedLocation, index: number): { landingUrl: string; source: "payload" | "sitemap" | "default" } => {
      const selected = this.selectLandingUrl({
        action: input.action,
        context: input.context,
        location,
        index,
        sitemapUrls
      });
      if (selected.source !== "sitemap" || sitemapUrls.length <= 1) {
        const normalized = normalizeHttpUrl(selected.landingUrl);
        if (normalized) {
          usedLandingUrls.add(normalized.toLowerCase());
        }
        return selected;
      }

      const seed = hashStringToNumber(`${input.action.id}:${location.locationId}:${index}:landing-unique`);
      for (let offset = 0; offset < sitemapUrls.length; offset += 1) {
        const candidate = sitemapUrls[(seed + offset) % sitemapUrls.length];
        const normalizedCandidate = normalizeHttpUrl(candidate);
        if (!normalizedCandidate) {
          continue;
        }
        const key = normalizedCandidate.toLowerCase();
        if (usedLandingUrls.has(key)) {
          continue;
        }
        usedLandingUrls.add(key);
        return {
          landingUrl: normalizedCandidate,
          source: "sitemap"
        };
      }

      const normalizedSelected = normalizeHttpUrl(selected.landingUrl);
      if (normalizedSelected) {
        usedLandingUrls.add(normalizedSelected.toLowerCase());
      }
      return selected;
    };
    const usedPostFingerprints = new Set<string>();
    const noAssetMediaMode =
      input.objective !== "schedule_follow_up_posts" &&
      input.objective !== "publish_scheduled_artifact" &&
      !mediaUrlFromPayload &&
      allowedAssets.length === 0;

    if (input.objective === "publish_scheduled_artifact") {
      const artifact = asRecord(input.action.payload.artifact);
      const artifactId = typeof artifact.id === "string" ? artifact.id : null;
      const artifactMetadata = asRecord(artifact.metadata);
      const locationId = typeof artifactMetadata.locationId === "string" ? artifactMetadata.locationId : null;
      const locationName = typeof artifactMetadata.locationName === "string" ? artifactMetadata.locationName : null;
      const location =
        input.context.locations.find((entry) => {
          if (locationId && entry.locationId === locationId) {
            return true;
          }
          if (locationName && entry.locationName === locationName) {
            return true;
          }
          return false;
        }) ?? input.context.locations[0];
      if (!location) {
        throw new Error("No GBP location available to publish scheduled content artifact");
      }

      const selectedAssetId = typeof artifactMetadata.mediaAssetId === "string" ? artifactMetadata.mediaAssetId : null;
      const selectedAsset = selectedAssetId ? allowedAssets.find((asset) => asset.id === selectedAssetId) ?? null : null;
      const landingUrl =
        normalizeHttpUrl(typeof artifactMetadata.landingUrl === "string" ? artifactMetadata.landingUrl : null) ??
        normalizeHttpUrl(typeof artifactMetadata.sourceLandingUrl === "string" ? artifactMetadata.sourceLandingUrl : null) ??
        normalizeHttpUrl(typeof artifactMetadata.ctaUrl === "string" ? artifactMetadata.ctaUrl : null);
      const ctaUrl =
        normalizeHttpUrl(typeof artifactMetadata.ctaUrl === "string" ? artifactMetadata.ctaUrl : null) ??
        normalizeHttpUrl(typeof artifactMetadata.shortUrl === "string" ? artifactMetadata.shortUrl : null) ??
        landingUrl;
      const summary =
        typeof artifactMetadata.snippet === "string" && artifactMetadata.snippet.trim()
          ? artifactMetadata.snippet.trim().slice(0, 1450)
          : truncateToMaxWords(String(artifact.body ?? ""), 220).slice(0, 1450);

      let mediaUrl: string | undefined = mediaUrlFromPayload ?? undefined;
      let processedStoragePath: string | null = null;
      let mediaGenerationError: string | null = null;
      const warnings: string[] = [];
      if (!selectedAssetId && !mediaUrlFromPayload) {
        warnings.push("Scheduled artifact has no assigned media asset. Publishing text-only to avoid duplicate/random asset reuse.");
      }
      if (selectedAssetId && !selectedAsset) {
        warnings.push(`Scheduled artifact media asset ${selectedAssetId} is not available. Publishing text-only.`);
      }
      if (!mediaUrl && selectedAsset && landingUrl) {
        const mediaResult = await this.generateQrOverlayMedia({
          asset: selectedAsset,
          clientId: input.action.clientId ?? input.context.connection.clientId,
          actionId: input.action.id,
          qrUrl: landingUrl
        });
        mediaUrl = mediaResult.mediaUrl ?? undefined;
        processedStoragePath = mediaResult.processedStoragePath;
        mediaGenerationError = mediaResult.error;
      }

      const response = await input.context.client.publishLocalPost(location.accountId, location.locationId, {
        summary,
        topicType: "STANDARD",
        mediaUrl,
        ctaUrl: ctaUrl ?? undefined
      });

      return {
        objective: input.objective,
        status: "published_scheduled_artifact",
        artifactId,
        title: typeof artifact.title === "string" ? artifact.title : null,
        locationId: location.locationId,
        locationName: location.locationName,
        ctaUrl,
        mediaAssetId: selectedAsset?.id ?? null,
        mediaProcessedStoragePath: processedStoragePath,
        mediaGenerationError,
        warnings,
        publishedPosts: [
          {
            name: response.name,
            accountId: location.accountId,
            locationId: location.locationId,
            locationName: location.locationName
          }
        ]
      };
    }

    if (input.objective === "manual_post_tool_publish") {
      return this.executeManualPostToolPublish({
        action: input.action,
        context: input.context,
        sitemapUrls,
        allowedAssets,
        ctaUrlFromPayload,
        mediaUrlFromPayload
      });
    }

    const publishedPosts: Array<Record<string, unknown>> = [];
    const queuedForApproval: Array<Record<string, unknown>> = [];
    const failed: Array<Record<string, unknown>> = [];
    const generatedLongFormDrafts: Array<Record<string, unknown>> = [];
    const executionWarnings: string[] = [];
    if (noAssetMediaMode) {
      executionWarnings.push(
        "No approved client media assets are available. Publishing text-only GBP posts (no fallback image)."
      );
    }
    const contentBundles = new Map<string, ContentLocationBundle>();
    if (normalizeHttpUrl(input.context.settings.sitemapUrl) && sitemapUrls.length === 0) {
      executionWarnings.push("Configured sitemap URL did not return usable page URLs; fallback URL strategy was used.");
    }

    for (const location of input.context.locations) {
      const landing = resolveUniqueLandingUrl(location, 0);
      const pageContext = await this.fetchLandingPageContext(landing.landingUrl);
      const snapshot = await this.fetchLocationSnapshot({ context: input.context, location });
      const competitors = await this.discoverTopCompetitors({
        snapshot,
        location,
        objectives: input.context.settings.objectives,
        maxResults: 5
      });
      const fallbackSuggestions = this.buildFallbackSemanticSuggestions({
        location,
        snapshot,
        objectives: input.context.settings.objectives
      });
      const signalBundle = await this.buildTrendSignalBundle({
        location,
        snapshot,
        pageContext,
        sitemapUrls,
        objectives: input.context.settings.objectives,
        competitors
      });
      const suggestionsRaw = await this.generateLocationSemanticSuggestions({
        location,
        snapshot,
        competitors,
        objectives: input.context.settings.objectives,
        settings: input.context.settings,
        sitemapUrls
      });
      const completenessQaPairs = mergeQaPairs(suggestionsRaw.qaPairs, fallbackSuggestions.qaPairs, maxQaPairs);
      const geoQaPack = await this.generateGeoQaSeedPack({
        location,
        snapshot,
        settings: input.context.settings,
        pageContext,
        sitemapUrls,
        trendSignals: signalBundle,
        competitors,
        limit: qnaTarget
      });
      const suggestions: LocationSemanticSuggestions = {
        ...suggestionsRaw,
        qaPairs: mergeQaPairs(geoQaPack.qaPairs, completenessQaPairs, maxQaPairs)
      };

      if (suggestions.warning) {
        executionWarnings.push(`${location.locationName}: ${suggestions.warning}`);
      }
      if (geoQaPack.warning) {
        executionWarnings.push(`${location.locationName}: ${geoQaPack.warning}`);
      }

      contentBundles.set(location.locationName, {
        location,
        snapshot,
        competitors,
        suggestions,
        signalBundle
      });

      const qaSeedPack = suggestions.qaPairs.slice(0, qnaTarget);
      if (input.objective !== "schedule_follow_up_posts" && qaSeedPack.length >= minQaPairs) {
        await this.deps.repository.createContentArtifact({
          organizationId: input.action.organizationId ?? input.context.connection.organizationId,
          clientId: input.action.clientId ?? input.context.connection.clientId,
          runId: input.action.runId,
          phase: "content",
          channel: "gbp_qna_seed",
          title: `GBP Q&A Seed Pack: ${location.title ?? snapshot.title ?? location.locationName}`,
          body: this.buildQaSeedArtifactBody({
            locationTitle: location.title ?? snapshot.title ?? "Business",
            cityState: formatCityState(snapshot.storefrontAddress),
            qaPairs: qaSeedPack
          }),
          metadata: {
            locationName: location.locationName,
            locationId: location.locationId,
            qaPairs: qaSeedPack,
            qaApiStatus: "discontinued_manual_seed_required",
            providerConstraint: "Google Business Profile Q&A API was discontinued on November 3, 2025.",
            operatorWorkflowStatus: requireOperatorApproval ? "pending_approval" : "ready_for_review",
            localQuestionIntents: signalBundle.localQuestionIntents,
            truthFacts: geoQaPack.truthFacts,
            localEntities: geoQaPack.localEntities,
            generationProvider: geoQaPack.provider,
            generationModel: geoQaPack.model
          },
          status: "draft"
        });
      }
    }

    const ensureUniquePostCopy = (inputCopy: {
      generatedCopy: GeneratedPostCopy;
      landingUrl: string;
      shortUrl: string;
      archetype: BurstArchetypePlan;
      index: number;
    }): GeneratedPostCopy | null => {
      let nextCopy = inputCopy.generatedCopy;
      let fingerprint = buildPostFingerprint({
        title: nextCopy.title,
        snippet: nextCopy.snippet,
        longForm: nextCopy.longForm,
        landingUrl: inputCopy.landingUrl,
        archetype: inputCopy.archetype.archetype
      });
      if (!usedPostFingerprints.has(fingerprint)) {
        usedPostFingerprints.add(fingerprint);
        return nextCopy;
      }

      const uniquenessSuffix = toSentenceCase(summarizeUrlPath(inputCopy.landingUrl)).slice(0, 38) || `Angle ${inputCopy.index + 1}`;
      const adjustedLongFormRaw = `${nextCopy.longForm}\n\n## Local URL Focus\nThis version aligns to ${inputCopy.landingUrl} with a distinct local angle and CTA path.`;
      const adjustedLongForm = truncateToMaxWords(adjustedLongFormRaw, input.context.settings.postWordCountMax);
      const adjustedSnippet = `${nextCopy.snippet.slice(0, 1280)} Focus URL: ${inputCopy.shortUrl}`.slice(0, 1450);
      nextCopy = {
        ...nextCopy,
        title: uniquePostTitle(nextCopy.title, uniquenessSuffix),
        longForm: adjustedLongForm,
        snippet: adjustedSnippet
      };

      fingerprint = buildPostFingerprint({
        title: nextCopy.title,
        snippet: nextCopy.snippet,
        longForm: nextCopy.longForm,
        landingUrl: inputCopy.landingUrl,
        archetype: inputCopy.archetype.archetype
      });
      if (usedPostFingerprints.has(fingerprint)) {
        return null;
      }

      usedPostFingerprints.add(fingerprint);
      return nextCopy;
    };

    if (input.objective === "schedule_follow_up_posts") {
      const windows = enforcedPostWindows;
      const scheduledArtifacts: Array<Record<string, unknown>> = [];

      for (let index = 0; index < windows.length; index += 1) {
        const bundle = input.context.locations.length
          ? contentBundles.get(input.context.locations[index % input.context.locations.length]?.locationName ?? "")
          : null;
        if (!bundle) {
          continue;
        }

        const window = windows[index] ?? `+${index + 1}d`;
        const selectedAsset = pickNextUniqueAsset();
        if (!selectedAsset && allowedAssets.length > 0) {
          executionWarnings.push("Asset pool exhausted for scheduled follow-up drafts. Remaining drafts will be text-only to avoid duplicate image reuse.");
        }
        const landing = resolveUniqueLandingUrl(bundle.location, index);
        const tinyUrlResult = await this.createTinyUrl(landing.landingUrl);
        const ctaUrl = ctaUrlFromPayload ?? tinyUrlResult.tinyUrl;
        const pageContext = await this.fetchLandingPageContext(landing.landingUrl);
        const archetype = buildBurstArchetypePlan(index, configuredArchetypes);
        const qaPair = bundle.suggestions.qaPairs[index % Math.max(1, bundle.suggestions.qaPairs.length)] ?? null;
        const generatedCopy = await this.generatePostCopy({
          locationTitle: bundle.location.title ?? bundle.snapshot.title ?? "our business",
          objective: "geo_content_follow_up",
          ordinal: index + 1,
          archetype,
          tone: input.context.settings.tone,
          wordRange: {
            min: input.context.settings.postWordCountMin,
            max: input.context.settings.postWordCountMax
          },
          landingUrl: landing.landingUrl,
          shortUrl: tinyUrlResult.tinyUrl,
          pageContext,
          objectives: input.context.settings.objectives,
          localTrendSignals: bundle.signalBundle.localTrendSignals,
          localQuestionIntents: bundle.signalBundle.localQuestionIntents,
          searchIntentSignals: bundle.signalBundle.searchIntentSignals,
          competitorCitationSignals: bundle.signalBundle.competitorCitationSignals,
          qaPair,
          ctaUrl
        });
        const uniqueCopy = ensureUniquePostCopy({
          generatedCopy,
          landingUrl: landing.landingUrl,
          shortUrl: tinyUrlResult.tinyUrl,
          archetype,
          index
        });
        if (!uniqueCopy) {
          executionWarnings.push(`Skipped duplicate follow-up draft candidate for ${landing.landingUrl}.`);
          continue;
        }
        const scheduledFor = parseRelativeWindow(new Date(), window, `${bundle.location.locationId}:${index}`);
        await this.deps.repository.createContentArtifact({
          organizationId: input.action.organizationId ?? input.context.connection.organizationId,
          clientId: input.action.clientId ?? input.context.connection.clientId,
          runId: input.action.runId,
          phase: "content",
          channel: "gbp",
          title: uniqueCopy.title,
          body: uniqueCopy.longForm,
          metadata: {
            snippet: uniqueCopy.snippet,
            locationName: bundle.location.locationName,
            locationId: bundle.location.locationId,
            landingUrl: landing.landingUrl,
            shortUrl: tinyUrlResult.tinyUrl,
            archetype: archetype.archetype,
            trendSignals: bundle.signalBundle.localTrendSignals,
            localQuestionIntents: bundle.signalBundle.localQuestionIntents,
            searchIntentSignals: bundle.signalBundle.searchIntentSignals,
            competitorCitationSignals: bundle.signalBundle.competitorCitationSignals,
            qaPair,
            mediaAssetId: selectedAsset?.id ?? null,
            operatorWorkflowStatus: requireOperatorApproval ? "pending_approval" : "scheduled",
            recommendedScheduledFor: scheduledFor
          },
          status: requireOperatorApproval ? "draft" : "scheduled",
          scheduledFor: requireOperatorApproval ? null : scheduledFor
        });
        scheduledArtifacts.push({
          locationName: bundle.location.locationName,
          scheduledFor,
          window,
          title: uniqueCopy.title,
          landingUrl: landing.landingUrl,
          archetype: archetype.archetype,
          mediaAssetId: selectedAsset?.id ?? null
        });
      }

      return {
        objective: input.objective,
        status: requireOperatorApproval ? "approval_required" : "scheduled_artifacts_created",
        windows,
        scheduledArtifactsCreated: requireOperatorApproval ? 0 : scheduledArtifacts.length,
        draftArtifactsCreated: requireOperatorApproval ? scheduledArtifacts.length : 0,
        scheduledArtifacts,
        postFrequencyPerWeek: enforcedPostsPerWeek,
        postsPerDay: HARDCODED_POSTS_PER_DAY,
        postingDaysPerWeek: HARDCODED_POST_DAYS_PER_WEEK,
        locationCount: input.context.locations.length
      };
    }

    const postCount = Math.min(this.options.maxPostBurst, enforcedPostsPerWeek);

    for (let index = 0; index < postCount; index += 1) {
      const bundle = input.context.locations.length
        ? contentBundles.get(input.context.locations[index % input.context.locations.length]?.locationName ?? "")
        : null;
      if (!bundle) {
        continue;
      }

      const selectedAsset = pickNextUniqueAsset();
      if (!selectedAsset && allowedAssets.length > 0) {
        executionWarnings.push("Asset pool exhausted for this run. Remaining posts will be text-only to avoid duplicate image reuse.");
      }
      const landing = resolveUniqueLandingUrl(bundle.location, index);
      const tinyUrlResult = await this.createTinyUrl(landing.landingUrl);
      if (!tinyUrlResult.success && tinyUrlResult.error) {
        executionWarnings.push(`TinyURL fallback for ${landing.landingUrl}: ${tinyUrlResult.error}`);
      }

      const ctaUrl = ctaUrlFromPayload ?? tinyUrlResult.tinyUrl;
      const pageContext = await this.fetchLandingPageContext(landing.landingUrl);
      const archetype = buildBurstArchetypePlan(index, configuredArchetypes);
      const qaPair = bundle.suggestions.qaPairs[index % Math.max(1, bundle.suggestions.qaPairs.length)] ?? null;

      let mediaUrl: string | undefined = mediaUrlFromPayload ?? undefined;
      let processedStoragePath: string | null = null;
      let mediaGenerationError: string | null = null;
      if (!mediaUrl && selectedAsset) {
        const mediaResult = await this.generateQrOverlayMedia({
          asset: selectedAsset,
          clientId: input.action.clientId ?? input.context.connection.clientId,
          actionId: input.action.id,
          qrUrl: landing.landingUrl
        });
        mediaUrl = mediaResult.mediaUrl ?? undefined;
        processedStoragePath = mediaResult.processedStoragePath;
        mediaGenerationError = mediaResult.error;
      }

      const generatedCopy = await this.generatePostCopy({
        locationTitle: bundle.location.title ?? bundle.snapshot.title ?? "our business",
        objective: input.objective,
        ordinal: index + 1,
        archetype,
        tone: input.context.settings.tone,
        wordRange: {
          min: input.context.settings.postWordCountMin,
          max: input.context.settings.postWordCountMax
        },
        landingUrl: landing.landingUrl,
        shortUrl: tinyUrlResult.tinyUrl,
        pageContext,
        objectives: input.context.settings.objectives,
        localTrendSignals: bundle.signalBundle.localTrendSignals,
        localQuestionIntents: bundle.signalBundle.localQuestionIntents,
        searchIntentSignals: bundle.signalBundle.searchIntentSignals,
        competitorCitationSignals: bundle.signalBundle.competitorCitationSignals,
        qaPair,
        ctaUrl
      });
      if (generatedCopy.warning) {
        executionWarnings.push(`Content generation fallback for ${landing.landingUrl}: ${generatedCopy.warning}`);
      }

      const uniqueCopy = ensureUniquePostCopy({
        generatedCopy,
        landingUrl: landing.landingUrl,
        shortUrl: tinyUrlResult.tinyUrl,
        archetype,
        index
      });
      if (!uniqueCopy) {
        executionWarnings.push(`Skipped duplicate post candidate for ${landing.landingUrl}.`);
        continue;
      }

      const summary = input.context.settings.eeatStructuredSnippetEnabled
        ? uniqueCopy.snippet
        : buildPostSummary({
            locationTitle: bundle.location.title ?? "our business",
            objective: input.objective,
            ordinal: index + 1,
            payload: input.action.payload
          });

      if (requireOperatorApproval) {
        const approvalWindow = enforcedPostWindows[index % enforcedPostWindows.length] ?? "+1d@14:30";
        const draftScheduledFor = parseRelativeWindow(new Date(), approvalWindow, `${bundle.location.locationId}:${index}:approval`);
        await this.deps.repository.createContentArtifact({
          organizationId: input.action.organizationId ?? input.context.connection.organizationId,
          clientId: input.action.clientId ?? input.context.connection.clientId,
          runId: input.action.runId,
          phase: "content",
          channel: "gbp",
          title: uniqueCopy.title,
          body: uniqueCopy.longForm,
          metadata: {
            snippet: summary,
            archetype: archetype.archetype,
            locationName: bundle.location.locationName,
            locationId: bundle.location.locationId,
            sourceLandingUrl: landing.landingUrl,
            shortUrl: tinyUrlResult.tinyUrl,
            ctaUrl,
            pageContext,
            trendSignals: bundle.signalBundle.localTrendSignals,
            localQuestionIntents: bundle.signalBundle.localQuestionIntents,
            searchIntentSignals: bundle.signalBundle.searchIntentSignals,
            competitorCitationSignals: bundle.signalBundle.competitorCitationSignals,
            qaPair,
            mediaAssetId: selectedAsset?.id ?? null,
            mediaProcessedStoragePath: processedStoragePath,
            operatorWorkflowStatus: "pending_approval",
            recommendedScheduledFor: draftScheduledFor,
            dispatchActionType: "post_publish",
            dispatchRiskTier: "medium"
          },
          status: "draft"
        });

        generatedLongFormDrafts.push({
          title: uniqueCopy.title,
          archetype: archetype.archetype,
          locationName: bundle.location.locationName,
          locationId: bundle.location.locationId,
          mediaAssetId: selectedAsset?.id ?? null,
          mediaProcessedStoragePath: processedStoragePath,
          mediaGenerationError,
          ctaUrl,
          sourceLandingUrl: landing.landingUrl,
          tinyUrl: tinyUrlResult.tinyUrl,
          urlSource: landing.source,
          contentProvider: uniqueCopy.provider,
          contentModel: uniqueCopy.model,
          contentWarning: uniqueCopy.warning ?? null,
          trendSignals: bundle.signalBundle.localTrendSignals,
          localQuestionIntents: bundle.signalBundle.localQuestionIntents,
          searchIntentSignals: bundle.signalBundle.searchIntentSignals,
          competitorCitationSignals: bundle.signalBundle.competitorCitationSignals,
          qaPair,
          pageContext,
          wordCount: wordCount(uniqueCopy.longForm),
          longForm: uniqueCopy.longForm
        });

        queuedForApproval.push({
          locationName: bundle.location.locationName,
          locationId: bundle.location.locationId,
          title: uniqueCopy.title,
          archetype: archetype.archetype,
          sourceLandingUrl: landing.landingUrl,
          tinyUrl: tinyUrlResult.tinyUrl,
          recommendedScheduledFor: draftScheduledFor
        });
        continue;
      }

      try {
        const response = await input.context.client.publishLocalPost(bundle.location.accountId, bundle.location.locationId, {
          summary,
          topicType: "STANDARD",
          mediaUrl,
          ctaUrl
        });
        await this.deps.repository.createContentArtifact({
          organizationId: input.action.organizationId ?? input.context.connection.organizationId,
          clientId: input.action.clientId ?? input.context.connection.clientId,
          runId: input.action.runId,
          phase: "content",
          channel: "gbp",
          title: uniqueCopy.title,
          body: uniqueCopy.longForm,
          metadata: {
            snippet: uniqueCopy.snippet,
            archetype: archetype.archetype,
            locationName: bundle.location.locationName,
            locationId: bundle.location.locationId,
            sourceLandingUrl: landing.landingUrl,
            shortUrl: tinyUrlResult.tinyUrl,
            ctaUrl,
            pageContext,
            trendSignals: bundle.signalBundle.localTrendSignals,
            localQuestionIntents: bundle.signalBundle.localQuestionIntents,
            searchIntentSignals: bundle.signalBundle.searchIntentSignals,
            competitorCitationSignals: bundle.signalBundle.competitorCitationSignals,
            qaPair,
            mediaAssetId: selectedAsset?.id ?? null,
            mediaProcessedStoragePath: processedStoragePath
          },
          status: "published",
          publishedAt: nowIso()
        });
        generatedLongFormDrafts.push({
          title: uniqueCopy.title,
          archetype: archetype.archetype,
          locationName: bundle.location.locationName,
          locationId: bundle.location.locationId,
          mediaAssetId: selectedAsset?.id ?? null,
          mediaProcessedStoragePath: processedStoragePath,
          mediaGenerationError,
          ctaUrl,
          sourceLandingUrl: landing.landingUrl,
          tinyUrl: tinyUrlResult.tinyUrl,
          urlSource: landing.source,
          contentProvider: uniqueCopy.provider,
          contentModel: uniqueCopy.model,
          contentWarning: uniqueCopy.warning ?? null,
          trendSignals: bundle.signalBundle.localTrendSignals,
          localQuestionIntents: bundle.signalBundle.localQuestionIntents,
          searchIntentSignals: bundle.signalBundle.searchIntentSignals,
          competitorCitationSignals: bundle.signalBundle.competitorCitationSignals,
          qaPair,
          pageContext,
          wordCount: wordCount(uniqueCopy.longForm),
          longForm: uniqueCopy.longForm
        });
        publishedPosts.push({
          name: response.name,
          archetype: archetype.archetype,
          accountId: bundle.location.accountId,
          locationId: bundle.location.locationId,
          locationName: bundle.location.locationName,
          title: bundle.location.title,
          postTitle: uniqueCopy.title,
          mediaAssetId: selectedAsset?.id ?? null,
          mediaProcessedStoragePath: processedStoragePath,
          sourceLandingUrl: landing.landingUrl,
          tinyUrl: tinyUrlResult.tinyUrl,
          urlSource: landing.source,
          ctaUrl
        });
      } catch (error) {
        failed.push({
          accountId: bundle.location.accountId,
          locationId: bundle.location.locationId,
          locationName: bundle.location.locationName,
          sourceLandingUrl: landing.landingUrl,
          tinyUrl: tinyUrlResult.tinyUrl,
          archetype: archetype.archetype,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    if (requireOperatorApproval) {
      if (!queuedForApproval.length) {
        throw new Error(`Post draft generation failed for all attempts: ${failed[0]?.error ?? "unknown error"}`);
      }
      return {
        objective: input.objective,
        status: "approval_required",
        postCountRequested: postCount,
        draftArtifactsCreated: queuedForApproval.length,
        postFrequencyPerWeek: enforcedPostsPerWeek,
        postsPerDay: HARDCODED_POSTS_PER_DAY,
        postingDaysPerWeek: HARDCODED_POST_DAYS_PER_WEEK,
        eeatStructuredSnippetEnabled: input.context.settings.eeatStructuredSnippetEnabled,
        qaSeedTarget: {
          min: minQaPairs,
          max: qnaTarget
        },
        postWordRange: {
          min: input.context.settings.postWordCountMin,
          max: input.context.settings.postWordCountMax
        },
        sitemapUrl: input.context.settings.sitemapUrl,
        sitemapUrlsDiscovered: sitemapUrls.length,
        contentSignalsByLocation: [...contentBundles.values()].map((bundle) => ({
          locationName: bundle.location.locationName,
          trendSignals: bundle.signalBundle.localTrendSignals,
          localQuestionIntents: bundle.signalBundle.localQuestionIntents,
          searchIntentSignals: bundle.signalBundle.searchIntentSignals,
          competitorCitationSignals: bundle.signalBundle.competitorCitationSignals,
          qaPairsGenerated: bundle.suggestions.qaPairs.length
        })),
        warnings: executionWarnings,
        queuedForApproval,
        generatedLongFormDrafts,
        failedPublishes: failed
      };
    }

    if (!publishedPosts.length) {
      throw new Error(`Post publish failed for all attempts: ${failed[0]?.error ?? "unknown error"}`);
    }

    return {
      objective: input.objective,
      postCountRequested: postCount,
      postCountPublished: publishedPosts.length,
      postFrequencyPerWeek: enforcedPostsPerWeek,
      postsPerDay: HARDCODED_POSTS_PER_DAY,
      postingDaysPerWeek: HARDCODED_POST_DAYS_PER_WEEK,
      eeatStructuredSnippetEnabled: input.context.settings.eeatStructuredSnippetEnabled,
      qaSeedTarget: {
        min: minQaPairs,
        max: maxQaPairs
      },
      postWordRange: {
        min: input.context.settings.postWordCountMin,
        max: input.context.settings.postWordCountMax
      },
      sitemapUrl: input.context.settings.sitemapUrl,
      sitemapUrlsDiscovered: sitemapUrls.length,
      contentSignalsByLocation: [...contentBundles.values()].map((bundle) => ({
        locationName: bundle.location.locationName,
        trendSignals: bundle.signalBundle.localTrendSignals,
        localQuestionIntents: bundle.signalBundle.localQuestionIntents,
        searchIntentSignals: bundle.signalBundle.searchIntentSignals,
        competitorCitationSignals: bundle.signalBundle.competitorCitationSignals,
        qaPairsGenerated: bundle.suggestions.qaPairs.length
      })),
      warnings: executionWarnings,
      publishedPosts,
      generatedLongFormDrafts,
      failedPublishes: failed
    };
  }

  private async executeReviewReplies(input: {
    action: BlitzAction;
    context: RunContext;
  }): Promise<Record<string, unknown>> {
    const objective =
      typeof input.action.payload.objective === "string"
        ? normalizeText(input.action.payload.objective)
        : "auto_reply_all_pending_reviews";
    if (objective === "review_request_dispatch") {
      return this.executeReviewRequestDispatch(input);
    }

    const organizationId = input.action.organizationId ?? input.context.connection.organizationId;
    const clientId = input.action.clientId ?? input.context.connection.clientId;
    const policy = await this.deps.repository.getAutopilotPolicy(clientId);
    const settingsMetadata = asRecord(input.context.settings.metadata);
    const policyDefaultMinRating = policy.reviewReplyAllRatingsEnabled ? 1 : 4;
    const metadataMinRating = toNumber(settingsMetadata.reviewAutoReplyMinRating, policyDefaultMinRating);
    const payloadMinRating = toNumber(input.action.payload.minAutoReplyRating, metadataMinRating);
    const minAutoReplyRating = clamp(Math.round(payloadMinRating), 1, 5);

    const maxReplies = Math.max(
      1,
      Math.min(this.options.maxReviewRepliesPerAction, toNumber(input.action.payload.maxReplies, 25))
    );
    const replied: Array<Record<string, unknown>> = [];
    const escalated: Array<Record<string, unknown>> = [];
    const failed: Array<Record<string, unknown>> = [];
    let pending = 0;

    for (const location of input.context.locations) {
      if (replied.length >= maxReplies) {
        break;
      }

      const reviews = await input.context.client.fetchReviews(location.accountId, location.locationId);
      const pendingReviews = reviews.filter((review) => !review.reviewReply?.comment);
      pending += pendingReviews.length;

      for (const review of pendingReviews) {
        if (replied.length >= maxReplies) {
          break;
        }

        const reviewId = parseReviewId(review.name, review.reviewId);
        const alreadyPosted = await this.deps.repository.hasPostedReplyHistory(clientId, reviewId);
        if (alreadyPosted) {
          continue;
        }

        const starRating = parseStarRating(review.starRating);
        const reviewerName = review.reviewer?.displayName ?? "there";
        const shouldEscalate = starRating > 0 && starRating < minAutoReplyRating;
        const replyText = replyForReview({
          reviewerName,
          starRating,
          comment: review.comment ?? "",
          locationTitle: location.title ?? "our business",
          tone: input.context.settings.tone,
          style: input.context.settings.reviewReplyStyle
        });

        if (shouldEscalate) {
          try {
            const actionNeededId = await this.queueActionNeeded({
              action: input.action,
              organizationId,
              clientId,
              location,
              title: `Manual review response needed (${starRating}-star)`,
              description: `A ${starRating}-star review from ${reviewerName} was routed to operator approval before posting to GBP.`,
              patch: {},
              updateMask: [],
              operations: [
                {
                  kind: "manual_review_reply",
                  reviewName: review.name,
                  reviewId,
                  reviewerName,
                  rating: starRating,
                  reviewText: review.comment ?? "",
                  suggestedReply: replyText
                }
              ],
              objective: "manual_review_response",
              actionType: "review_reply",
              riskTier: starRating <= 2 ? "critical" : "high",
              metadata: {
                reviewName: review.name,
                reviewId,
                reviewerName,
                rating: starRating,
                reviewText: review.comment ?? "",
                suggestedReply: replyText,
                reason: `rating_below_threshold_${minAutoReplyRating}`
              }
            });

            await this.deps.repository.recordReviewReplyHistory({
              organizationId,
              clientId,
              runId: input.action.runId,
              locationId: location.locationId,
              reviewId,
              reviewRating: starRating,
              reviewText: review.comment ?? "",
              replyText,
              replyStatus: "escalated"
            });

            escalated.push({
              reviewName: review.name,
              reviewId,
              locationName: location.locationName,
              accountId: location.accountId,
              rating: starRating,
              actionNeededId
            });
          } catch (error) {
            failed.push({
              reviewName: review.name,
              reviewId,
              locationName: location.locationName,
              error: error instanceof Error ? error.message : String(error)
            });
          }
          continue;
        }

        try {
          await input.context.client.postReviewReply(location.accountId, location.locationId, reviewId, replyText);
          await this.deps.repository.recordReviewReplyHistory({
            organizationId,
            clientId,
            runId: input.action.runId,
            locationId: location.locationId,
            reviewId,
            reviewRating: starRating,
            reviewText: review.comment ?? "",
            replyText,
            replyStatus: "posted"
          });
          replied.push({
            reviewName: review.name,
            reviewId,
            locationName: location.locationName,
            accountId: location.accountId,
            rating: starRating
          });
        } catch (error) {
          await this.deps.repository.recordReviewReplyHistory({
            organizationId,
            clientId,
            runId: input.action.runId,
            locationId: location.locationId,
            reviewId,
            reviewRating: starRating,
            reviewText: review.comment ?? "",
            replyText,
            replyStatus: "failed",
            error: error instanceof Error ? error.message : String(error)
          });
          failed.push({
            reviewName: review.name,
            reviewId,
            locationName: location.locationName,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }

    if (pending > 0 && replied.length === 0 && escalated.length === 0) {
      throw new Error(`Review reply action found pending reviews but failed to post replies: ${failed[0]?.error ?? "unknown error"}`);
    }

    return {
      objective,
      pendingReviewsFound: pending,
      minAutoReplyRating,
      repliesPosted: replied.length,
      repliesEscalated: escalated.length,
      repliesFailed: failed.length,
      replied,
      escalated,
      failed
    };
  }

  private async executeReviewRequestDispatch(input: {
    action: BlitzAction;
    context: RunContext;
  }): Promise<Record<string, unknown>> {
    const channelRaw = typeof input.action.payload.channel === "string" ? input.action.payload.channel : "";
    const channel = channelRaw.trim().toLowerCase();
    const dryRun =
      (process.env.BLITZ_REVIEW_REQUEST_DRY_RUN ?? "false").trim().toLowerCase() === "true";
    const objective =
      typeof input.action.payload.objective === "string"
        ? normalizeText(input.action.payload.objective)
        : "review_request_dispatch";

    if (channel !== "sms" && channel !== "email") {
      throw new Error(`Unsupported review request channel: ${channelRaw || "unknown"}`);
    }

    const toPhone = typeof input.action.payload.toPhone === "string" ? input.action.payload.toPhone.trim() : "";
    const toEmail = typeof input.action.payload.toEmail === "string" ? input.action.payload.toEmail.trim() : "";
    const reviewUrl = normalizeHttpUrl(
      typeof input.action.payload.reviewUrl === "string" ? input.action.payload.reviewUrl : null
    );
    const baseMessage =
      typeof input.action.payload.messageBody === "string"
        ? normalizeText(input.action.payload.messageBody)
        : "";
    const fallbackMessage = reviewUrl
      ? `Thanks for choosing us. If we earned it, please leave a quick review: ${reviewUrl}`
      : "Thanks for choosing us. If we earned it, please leave a quick review.";
    const messageBody = (baseMessage || fallbackMessage).slice(0, 1400);

    if (channel === "sms" && !toPhone) {
      return {
        objective,
        status: "skipped_missing_recipient",
        channel,
        delivered: false
      };
    }
    if (channel === "email" && !toEmail) {
      return {
        objective,
        status: "skipped_missing_recipient",
        channel,
        delivered: false
      };
    }

    if (dryRun) {
      return {
        objective,
        status: "dry_run",
        channel,
        delivered: false,
        messageBody
      };
    }

    if (channel === "sms") {
      const result = await this.sendTwilioSmsReviewRequest({
        toPhone,
        messageBody
      });
      return {
        objective,
        status: "sent",
        channel,
        provider: "twilio",
        delivered: true,
        toPhone,
        providerMessageId: result.providerMessageId,
        providerStatus: result.providerStatus
      };
    }

    const subject =
      typeof input.action.payload.emailSubject === "string" && input.action.payload.emailSubject.trim().length > 0
        ? input.action.payload.emailSubject.trim()
        : "Quick favor from your recent service visit";
    const emailBody =
      typeof input.action.payload.emailBody === "string" && input.action.payload.emailBody.trim().length > 0
        ? input.action.payload.emailBody.trim()
        : messageBody;
    const result = await this.sendSendgridReviewRequestEmail({
      toEmail,
      subject,
      bodyText: emailBody
    });
    return {
      objective,
      status: "sent",
      channel,
      provider: "sendgrid",
      delivered: true,
      toEmail,
      providerMessageId: result.providerMessageId,
      providerStatus: result.providerStatus
    };
  }

  private async sendTwilioSmsReviewRequest(input: {
    toPhone: string;
    messageBody: string;
  }): Promise<{ providerMessageId: string | null; providerStatus: string | null }> {
    const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
    const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
    const fromPhone = process.env.TWILIO_FROM_NUMBER?.trim();
    if (!accountSid || !authToken || !fromPhone) {
      throw new Error("Twilio is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER.");
    }

    const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
    const body = new URLSearchParams({
      To: input.toPhone,
      From: fromPhone,
      Body: input.messageBody
    });
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: body.toString()
    });
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok) {
      const detail =
        (payload && typeof payload.message === "string" && payload.message.trim()) ||
        `HTTP ${response.status}`;
      throw new Error(`Twilio review request send failed: ${detail}`);
    }

    return {
      providerMessageId: payload && typeof payload.sid === "string" ? payload.sid : null,
      providerStatus: payload && typeof payload.status === "string" ? payload.status : null
    };
  }

  private async sendSendgridReviewRequestEmail(input: {
    toEmail: string;
    subject: string;
    bodyText: string;
  }): Promise<{ providerMessageId: string | null; providerStatus: string | null }> {
    const apiKey = process.env.SENDGRID_API_KEY?.trim();
    const fromEmail = process.env.SENDGRID_FROM_EMAIL?.trim();
    const fromName = process.env.SENDGRID_FROM_NAME?.trim() || "Blitz Agent";
    if (!apiKey || !fromEmail) {
      throw new Error("SendGrid is not configured. Set SENDGRID_API_KEY and SENDGRID_FROM_EMAIL.");
    }

    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: input.toEmail }] }],
        from: {
          email: fromEmail,
          name: fromName
        },
        subject: input.subject,
        content: [
          {
            type: "text/plain",
            value: input.bodyText
          }
        ]
      })
    });

    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 500);
      throw new Error(`SendGrid review request send failed: HTTP ${response.status}${detail ? ` (${detail})` : ""}`);
    }

    return {
      providerMessageId: response.headers.get("x-message-id"),
      providerStatus: String(response.status)
    };
  }

  private async executeHoursUpdate(input: {
    action: BlitzAction;
    context: RunContext;
  }): Promise<Record<string, unknown>> {
    const hoursPatch = asRecord(input.action.payload.hoursPatch);
    const updateMask = toStringArray(input.action.payload.updateMask);

    if (Object.keys(hoursPatch).length > 0 && updateMask.length > 0) {
      const updated: string[] = [];
      const failed: Array<Record<string, unknown>> = [];
      for (const location of input.context.locations) {
        try {
          await input.context.client.patchLocation(location.locationName, hoursPatch, updateMask);
          updated.push(location.locationName);
        } catch (error) {
          failed.push({
            locationName: location.locationName,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      if (!updated.length) {
        throw new Error(`Hours update failed across scoped locations: ${failed[0]?.error ?? "unknown error"}`);
      }

      return {
        objective: input.action.payload.objective ?? "cta_and_timing_optimizer",
        updatedLocations: updated,
        failedLocations: failed
      };
    }

    const recommendations: Array<Record<string, unknown>> = [];
    const queuedActionNeededIds: string[] = [];
    const warnings: string[] = [];
    const organizationId = input.action.organizationId ?? input.context.connection.organizationId;
    const clientId = input.action.clientId ?? input.context.connection.clientId;
    const shouldQueueActionsNeeded = input.action.payload.queueActionsNeeded !== false;
    const lookbackDays = clamp(toNumber(input.action.payload.lookbackDays, 14), 7, 28);

    for (const location of input.context.locations) {
      try {
        const snapshot = await this.fetchLocationSnapshot({ context: input.context, location });
        const performance = await this.fetchRecentInteractionMetrics({
          accessToken: input.context.token.accessToken,
          locationName: location.locationName,
          lookbackDays
        });
        const dominantSignal =
          performance.calls >= performance.directions && performance.calls >= performance.clicks
            ? "calls"
            : performance.directions >= performance.clicks
              ? "directions"
              : "website_clicks";
        const locationLabel = normalizeText(snapshot.title ?? location.title ?? "this location");
        const ctaVariants =
          dominantSignal === "calls"
            ? [
                `Tap Call now for priority ${locationLabel} dispatch`,
                "Call now to confirm same-day availability"
              ]
            : dominantSignal === "directions"
              ? [
                  `Tap Directions now to visit ${locationLabel}`,
                  "Get directions now before close of business"
                ]
              : [
                  "Tap Website for service details and next available slot",
                  "Open Website now to request scheduling"
                ];
        const suggestedHoursAdjustment =
          !snapshot.specialHours && (performance.calls > 0 || performance.directions > 0)
            ? "Review special hours coverage for peak local demand windows."
            : "Current hours pattern does not need an automated change.";

        if (shouldQueueActionsNeeded && suggestedHoursAdjustment.startsWith("Review")) {
          const actionNeededId = await this.queueActionNeeded({
            action: input.action,
            organizationId,
            clientId,
            location,
            title: "Review temporary/special hours recommendation",
            description: `Interaction velocity indicates ${dominantSignal} as the dominant GBP action over the last ${lookbackDays} days.`,
            patch: {},
            updateMask: [],
            operations: [
              {
                kind: "manual_hours_review",
                locationName: location.locationName,
                dominantSignal,
                lookbackDays,
                suggestedHoursAdjustment,
                suggestedCtaVariants: ctaVariants,
                recentMetrics: performance
              }
            ],
            objective: "interaction_velocity_booster",
            actionType: "hours_update",
            riskTier: "medium",
            metadata: {
              dominantSignal,
              lookbackDays,
              recentMetrics: performance,
              suggestedHoursAdjustment,
              suggestedCtaVariants: ctaVariants
            }
          });
          queuedActionNeededIds.push(actionNeededId);
        }

        recommendations.push({
          locationName: location.locationName,
          locationId: location.locationId,
          title: snapshot.title ?? location.title,
          recentMetrics: performance,
          dominantSignal,
          suggestedCtaVariants: ctaVariants,
          suggestedHoursAdjustment,
          operatorAction: suggestedHoursAdjustment.startsWith("Review") ? "manual_review_recommended" : "none",
          interactionVelocityHint:
            dominantSignal === "calls"
              ? "Prioritize call-driven CTAs on posts and profile assets."
              : dominantSignal === "directions"
                ? "Prioritize direction-driven CTAs and location cues."
                : "Prioritize website CTA variants tied to booking intent."
        });
      } catch (error) {
        warnings.push(`${location.locationName}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return {
      objective: input.action.payload.objective ?? "cta_and_timing_optimizer",
      status: "insight_recommendations_generated",
      locationCount: input.context.locations.length,
      queuedActionsNeeded: queuedActionNeededIds.length,
      queuedActionNeededIds,
      recommendations,
      warnings
    };
  }

  private async fetchRecentInteractionMetrics(input: {
    accessToken: string;
    locationName: string;
    lookbackDays: number;
  }): Promise<{ clicks: number; calls: number; directions: number; impressions: number }> {
    const dateTo = new Date();
    const dateFrom = new Date();
    dateFrom.setUTCDate(dateFrom.getUTCDate() - (input.lookbackDays - 1));
    const start = toDateParts(dateFrom);
    const end = toDateParts(dateTo);
    const endpoint = new URL(
      `https://businessprofileperformance.googleapis.com/v1/${input.locationName}:fetchMultiDailyMetricsTimeSeries`
    );
    for (const metric of [
      "WEBSITE_CLICKS",
      "CALL_CLICKS",
      "BUSINESS_DIRECTION_REQUESTS",
      "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
      "BUSINESS_IMPRESSIONS_MOBILE_MAPS"
    ]) {
      endpoint.searchParams.append("dailyMetrics", metric);
    }
    endpoint.searchParams.set("dailyRange.start_date.year", start.year);
    endpoint.searchParams.set("dailyRange.start_date.month", start.month);
    endpoint.searchParams.set("dailyRange.start_date.day", start.day);
    endpoint.searchParams.set("dailyRange.end_date.year", end.year);
    endpoint.searchParams.set("dailyRange.end_date.month", end.month);
    endpoint.searchParams.set("dailyRange.end_date.day", end.day);

    const payload = await this.requestJsonWithAuth<{
      multiDailyMetricTimeSeries?: Array<{
        dailyMetric?: string;
        timeSeries?: {
          datedValues?: Array<{ value?: string | number }>;
        };
      }>;
    }>({
      url: endpoint.toString(),
      accessToken: input.accessToken
    });

    return (payload.multiDailyMetricTimeSeries ?? []).reduce(
      (acc, series) => {
        const total = (series.timeSeries?.datedValues ?? []).reduce((sum, entry) => sum + toNumber(entry.value, 0), 0);
        switch (series.dailyMetric) {
          case "WEBSITE_CLICKS":
            acc.clicks += total;
            break;
          case "CALL_CLICKS":
            acc.calls += total;
            break;
          case "BUSINESS_DIRECTION_REQUESTS":
            acc.directions += total;
            break;
          case "BUSINESS_IMPRESSIONS_DESKTOP_MAPS":
          case "BUSINESS_IMPRESSIONS_MOBILE_MAPS":
            acc.impressions += total;
            break;
          default:
            break;
        }
        return acc;
      },
      {
        clicks: 0,
        calls: 0,
        directions: 0,
        impressions: 0
      }
    );
  }

  private isTokenExpiring(token: TokenPayload, bufferSeconds: number): boolean {
    const expiresAtMs = new Date(token.expiresAt).getTime();
    if (Number.isNaN(expiresAtMs)) {
      return false;
    }
    return expiresAtMs - Date.now() <= bufferSeconds * 1000;
  }
}
