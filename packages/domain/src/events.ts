import type { BlitzPhase } from "./types";

export const eventTypeValues = [
  "blitz.run.requested",
  "blitz.phase.started",
  "blitz.action.executed",
  "blitz.action.failed",
  "blitz.run.completed",
  "attribution.sync.requested"
] as const;

export type EventType = (typeof eventTypeValues)[number];

export interface BaseEvent<TType extends EventType, TPayload> {
  id: string;
  type: TType;
  timestamp: string;
  payload: TPayload;
}

export type BlitzRunRequestedEvent = BaseEvent<
  "blitz.run.requested",
  { runId: string; organizationId: string; clientId: string; triggeredBy: string }
>;

export type BlitzPhaseStartedEvent = BaseEvent<
  "blitz.phase.started",
  { runId: string; phase: BlitzPhase }
>;

export type BlitzActionExecutedEvent = BaseEvent<
  "blitz.action.executed",
  { runId: string; actionId: string; phase: BlitzPhase }
>;

export type BlitzActionFailedEvent = BaseEvent<
  "blitz.action.failed",
  { runId: string; actionId: string; phase: BlitzPhase; error: string }
>;

export type BlitzRunCompletedEvent = BaseEvent<
  "blitz.run.completed",
  { runId: string; organizationId: string; clientId: string; status: "completed" | "failed" }
>;

export type AttributionSyncRequestedEvent = BaseEvent<
  "attribution.sync.requested",
  { organizationId: string; clientId: string; date: string }
>;

export type AiblitzEvent =
  | BlitzRunRequestedEvent
  | BlitzPhaseStartedEvent
  | BlitzActionExecutedEvent
  | BlitzActionFailedEvent
  | BlitzRunCompletedEvent
  | AttributionSyncRequestedEvent;
