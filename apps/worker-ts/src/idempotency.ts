import { createHash } from "node:crypto";
import type { BlitzActionType, BlitzPhase } from "@trd-aiblitz/domain";

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort((a, b) => a.localeCompare(b));
  const entries = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${entries.join(",")}}`;
}

export function buildActionIdempotencyKey(input: {
  runId: string;
  phase: BlitzPhase;
  actionType: BlitzActionType;
  payload: Record<string, unknown>;
}): string {
  const raw = `${input.runId}:${input.phase}:${input.actionType}:${stableStringify(input.payload)}`;
  const digest = createHash("sha256").update(raw).digest("hex");
  return `${input.runId}:${input.phase}:${input.actionType}:${digest.slice(0, 20)}`;
}
