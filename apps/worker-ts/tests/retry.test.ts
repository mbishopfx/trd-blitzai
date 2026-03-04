import { describe, expect, it, vi } from "vitest";
import { computeBackoffDelayMs, retryWithBackoff } from "../src/retry";

describe("retryWithBackoff", () => {
  it("retries and eventually resolves", async () => {
    let attempts = 0;

    const result = await retryWithBackoff(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error("transient");
        }
        return "ok";
      },
      {
        attempts: 4,
        baseDelayMs: 1,
        maxDelayMs: 2
      }
    );

    expect(result).toBe("ok");
    expect(attempts).toBe(3);
  });

  it("throws after exhausting attempts", async () => {
    const onRetry = vi.fn();

    await expect(
      retryWithBackoff(
        async () => {
          throw new Error("always fails");
        },
        {
          attempts: 3,
          baseDelayMs: 1,
          maxDelayMs: 2,
          onRetry
        }
      )
    ).rejects.toThrow("always fails");

    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it("computes bounded exponential delay", () => {
    const delay = computeBackoffDelayMs(100, 1000, 5);
    expect(delay).toBeGreaterThanOrEqual(1000);
    expect(delay).toBeLessThanOrEqual(1000);
  });
});
