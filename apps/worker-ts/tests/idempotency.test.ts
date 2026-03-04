import { describe, expect, it } from "vitest";
import { buildActionIdempotencyKey } from "../src/idempotency";

describe("buildActionIdempotencyKey", () => {
  it("is deterministic regardless of payload key order", () => {
    const first = buildActionIdempotencyKey({
      runId: "run-1",
      phase: "content",
      actionType: "post_publish",
      payload: {
        a: 1,
        nested: {
          b: true,
          c: [1, 2]
        }
      }
    });

    const second = buildActionIdempotencyKey({
      runId: "run-1",
      phase: "content",
      actionType: "post_publish",
      payload: {
        nested: {
          c: [1, 2],
          b: true
        },
        a: 1
      }
    });

    expect(first).toBe(second);
  });

  it("changes when payload changes", () => {
    const first = buildActionIdempotencyKey({
      runId: "run-1",
      phase: "reviews",
      actionType: "review_reply",
      payload: {
        ratingBand: "high"
      }
    });

    const second = buildActionIdempotencyKey({
      runId: "run-1",
      phase: "reviews",
      actionType: "review_reply",
      payload: {
        ratingBand: "low"
      }
    });

    expect(first).not.toBe(second);
  });
});
