import type { BlitzRun, BlitzRunStatus } from "./types";

const transitions: Record<BlitzRunStatus, ReadonlySet<BlitzRunStatus>> = {
  created: new Set(["running", "failed"]),
  running: new Set(["completed", "failed", "partially_completed", "rolled_back"]),
  completed: new Set(),
  failed: new Set(["rolled_back"]),
  partially_completed: new Set(["running", "completed", "rolled_back", "failed"]),
  rolled_back: new Set(["running", "completed"])
};

export function canTransitionRunStatus(from: BlitzRunStatus, to: BlitzRunStatus): boolean {
  if (from === to) {
    return true;
  }
  return transitions[from].has(to);
}

export function assertValidRunStatusTransition(from: BlitzRunStatus, to: BlitzRunStatus): void {
  if (!canTransitionRunStatus(from, to)) {
    throw new Error(`Invalid run status transition: ${from} -> ${to}`);
  }
}

export function transitionRunStatus(run: BlitzRun, to: BlitzRunStatus, nowIso = new Date().toISOString()): BlitzRun {
  assertValidRunStatusTransition(run.status, to);

  const next: BlitzRun = {
    ...run,
    status: to
  };

  if (to === "running" && !next.startedAt) {
    next.startedAt = nowIso;
  }

  if (to === "completed" || to === "failed" || to === "partially_completed" || to === "rolled_back") {
    next.completedAt = nowIso;
  }

  return next;
}
