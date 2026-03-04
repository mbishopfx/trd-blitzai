import pino from "pino";
import type { AiblitzEvent } from "@trd-aiblitz/domain";
import type { EventPublisher } from "./types";

const logger = pino({ name: "aiblitz-worker-events" });

export class LogEventPublisher implements EventPublisher {
  async publish(event: AiblitzEvent): Promise<void> {
    if (process.env.NODE_ENV === "test") {
      return;
    }
    logger.info({ event }, "published event");
  }
}
