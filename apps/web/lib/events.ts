import { Queue } from "bullmq";
import type { AiblitzEvent } from "@trd-aiblitz/domain";

const BLITZ_QUEUE_NAME = "blitz-runs";
let blitzQueue: Queue | null = null;

function getBlitzQueue(): Queue | null {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    return null;
  }

  if (!blitzQueue) {
    blitzQueue = new Queue(BLITZ_QUEUE_NAME, {
      connection: {
        url: redisUrl
      }
    });
  }

  return blitzQueue;
}

export async function publishEvent(event: AiblitzEvent): Promise<void> {
  if (event.type === "blitz.run.requested") {
    const queue = getBlitzQueue();
    if (queue) {
      await queue.add(
        "blitz.run",
        {
          runId: event.payload.runId,
          requestedAt: event.timestamp
        },
        {
          attempts: 6,
          backoff: {
            type: "exponential",
            delay: 2000
          },
          removeOnComplete: true,
          removeOnFail: false
        }
      );
      return;
    }
  }

  if (process.env.NODE_ENV !== "test") {
    console.log("[EVENT]", JSON.stringify(event));
  }
}
