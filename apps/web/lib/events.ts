import type { AiblitzEvent } from "@trd-aiblitz/domain";

export async function publishEvent(event: AiblitzEvent): Promise<void> {
  // Placeholder for Redis stream / queue publish. Kept deterministic for v1 scaffold.
  // The worker service can subscribe via shared durable storage in production.
  if (process.env.NODE_ENV !== "test") {
    console.log("[EVENT]", JSON.stringify(event));
  }
}
