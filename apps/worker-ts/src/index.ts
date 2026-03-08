import { randomUUID } from "node:crypto";
import pino from "pino";
import type { BlitzRun } from "@trd-aiblitz/domain";
import { LogEventPublisher } from "./event-bus";
import { GbpLiveActionExecutor } from "./executors/gbp-live";
import { NoopActionExecutor } from "./executors/noop";
import { BlitzRunOrchestrator } from "./orchestrator";
import { DefaultBlitzPlanner } from "./planner";
import { startBlitzWorker } from "./queue";
import { InMemoryBlitzRepository } from "./repository/in-memory";
import { SupabaseBlitzRepository } from "./repository/supabase";
import { startScheduledContentDispatcher } from "./scheduled-content";
import { getSupabaseServiceClient, isSupabaseConfigured } from "./supabase";
import type { ActionExecutor, BlitzRunRepository } from "./types";

const logger = pino({ name: "aiblitz-worker" });

function createSeedRun(): BlitzRun {
  return {
    id: process.env.SEED_RUN_ID ?? randomUUID(),
    organizationId: process.env.SEED_ORG_ID ?? "demo-org",
    clientId: process.env.SEED_CLIENT_ID ?? "demo-client",
    status: "created",
    startedAt: null,
    completedAt: null,
    createdBy: process.env.SEED_USER_ID ?? "system",
    createdAt: new Date().toISOString(),
    policySnapshot: {
      source: "seed",
      autopilot: true
    },
    summary: null
  };
}

async function runInProcess(): Promise<void> {
  const run = createSeedRun();
  const repository = new InMemoryBlitzRepository({ runs: [run] });
  const orchestrator = new BlitzRunOrchestrator({
    repository,
    planner: new DefaultBlitzPlanner(),
    executor: createExecutor(repository, { allowLive: false }),
    events: new LogEventPublisher()
  });

  await orchestrator.executeRun(run.id);
  logger.info({ runId: run.id }, "completed in-process blitz run");
}

function createQueueRepository(): BlitzRunRepository {
  if (isSupabaseConfigured()) {
    return new SupabaseBlitzRepository(getSupabaseServiceClient());
  }

  logger.warn("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured; using in-memory repository in queue mode");
  return new InMemoryBlitzRepository();
}

function createExecutor(repository: BlitzRunRepository, options?: { allowLive?: boolean }): ActionExecutor {
  if ((process.env.BLITZ_EXECUTOR_MODE ?? "live") === "noop") {
    logger.warn("BLITZ_EXECUTOR_MODE=noop set; using simulated executor");
    return new NoopActionExecutor();
  }

  if (options?.allowLive === false) {
    logger.warn("in-process seed mode detected; using simulated executor");
    return new NoopActionExecutor();
  }

  if (!isSupabaseConfigured()) {
    logger.warn("Supabase is not configured; falling back to simulated executor");
    return new NoopActionExecutor();
  }

  return new GbpLiveActionExecutor({ repository });
}

async function main(): Promise<void> {
  if (process.env.REDIS_URL) {
    logger.info("starting BullMQ worker mode");
    const repository = createQueueRepository();
    const executor = createExecutor(repository, { allowLive: true });
    startBlitzWorker({
      repository,
      planner: new DefaultBlitzPlanner(),
      executor,
      events: new LogEventPublisher()
    });
    const scheduledDispatcherEnabled = (process.env.SCHEDULED_CONTENT_DISPATCHER_ENABLED ?? "true")
      .trim()
      .toLowerCase() === "true";
    if (scheduledDispatcherEnabled) {
      startScheduledContentDispatcher({
        repository,
        executor,
        intervalMs: Number(process.env.SCHEDULED_CONTENT_POLL_MS ?? "60000"),
        batchSize: Number(process.env.SCHEDULED_CONTENT_BATCH_SIZE ?? "8")
      });
      logger.info("scheduled content dispatcher enabled");
    } else {
      logger.info("scheduled content dispatcher disabled (set SCHEDULED_CONTENT_DISPATCHER_ENABLED=true to enable)");
    }
    return;
  }

  logger.warn("REDIS_URL not set; running in-process execution mode");
  await runInProcess();
}

main().catch((error) => {
  logger.error({ error: error instanceof Error ? error.message : String(error) }, "worker failed");
  process.exitCode = 1;
});
