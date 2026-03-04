import { randomUUID } from "node:crypto";
import pino from "pino";
import type { BlitzRun } from "@trd-aiblitz/domain";
import { LogEventPublisher } from "./event-bus";
import { NoopActionExecutor } from "./executors/noop";
import { BlitzRunOrchestrator } from "./orchestrator";
import { DefaultBlitzPlanner } from "./planner";
import { startBlitzWorker } from "./queue";
import { InMemoryBlitzRepository } from "./repository/in-memory";

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
    executor: new NoopActionExecutor(),
    events: new LogEventPublisher()
  });

  await orchestrator.executeRun(run.id);
  logger.info({ runId: run.id }, "completed in-process blitz run");
}

async function main(): Promise<void> {
  if (process.env.REDIS_URL) {
    logger.info("starting BullMQ worker mode");
    startBlitzWorker({
      repository: new InMemoryBlitzRepository(),
      planner: new DefaultBlitzPlanner(),
      executor: new NoopActionExecutor(),
      events: new LogEventPublisher()
    });
    return;
  }

  logger.warn("REDIS_URL not set; running in-process execution mode");
  await runInProcess();
}

main().catch((error) => {
  logger.error({ error: error instanceof Error ? error.message : String(error) }, "worker failed");
  process.exitCode = 1;
});
