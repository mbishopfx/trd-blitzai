import { Job, Queue, Worker } from "bullmq";
import pino from "pino";
import { BlitzRunOrchestrator, type BlitzRunOrchestratorDependencies } from "./orchestrator";

const logger = pino({ name: "aiblitz-worker-queue" });

export const BLITZ_QUEUE_NAME = "blitz-runs";

export interface BlitzRunJob {
  runId: string;
  requestedAt: string;
}

export interface BlitzQueue {
  enqueueRun(job: BlitzRunJob): Promise<string>;
  close(): Promise<void>;
}

function redisConnection(url?: string): { url: string } {
  const redisUrl = url ?? process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("REDIS_URL is required to use BullMQ queue mode");
  }

  return {
    url: redisUrl
  };
}

export function createBlitzQueue(url?: string): BlitzQueue {
  const connection = redisConnection(url);
  const queue = new Queue<BlitzRunJob, void, "blitz.run">(BLITZ_QUEUE_NAME, { connection });

  return {
    async enqueueRun(job) {
      const queued = await queue.add("blitz.run", job, {
        attempts: 6,
        backoff: {
          type: "exponential",
          delay: 2000
        },
        removeOnComplete: true,
        removeOnFail: false
      });

      return queued.id ?? "unknown";
    },
    async close() {
      await queue.close();
    }
  };
}

export interface StartedWorker {
  worker: Worker<BlitzRunJob, void, "blitz.run">;
  close(): Promise<void>;
}

export function startBlitzWorker(deps: BlitzRunOrchestratorDependencies, url?: string): StartedWorker {
  const connection = redisConnection(url);
  const orchestrator = new BlitzRunOrchestrator(deps);

  const worker = new Worker<BlitzRunJob, void, "blitz.run">(
    BLITZ_QUEUE_NAME,
    async (job: Job<BlitzRunJob, void, "blitz.run">) => {
      logger.info({ jobId: job.id, runId: job.data.runId }, "processing blitz run job");
      await orchestrator.executeRun(job.data.runId);
    },
    {
      connection,
      concurrency: Number(process.env.BLITZ_WORKER_CONCURRENCY ?? "4")
    }
  );

  worker.on("completed", (job) => {
    logger.info({ jobId: job.id, runId: job.data.runId }, "blitz run job completed");
  });

  worker.on("failed", (job, err) => {
    logger.error(
      { jobId: job?.id, runId: job?.data.runId, err: err?.message ?? String(err) },
      "blitz run job failed"
    );
  });

  return {
    worker,
    async close() {
      await worker.close();
    }
  };
}
