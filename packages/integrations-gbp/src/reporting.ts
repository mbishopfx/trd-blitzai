import type { GbpHealthScore, GbpSnapshot, SnapshotChange } from "./types";

export interface WeeklyWatchdogReport {
  generatedAt: string;
  locationName: string;
  health: GbpHealthScore;
  changeSummary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    total: number;
  };
  highlights: string[];
}

export function buildWeeklyWatchdogReport(input: {
  previousSnapshot: GbpSnapshot;
  currentSnapshot: GbpSnapshot;
  health: GbpHealthScore;
  changes: SnapshotChange[];
}): WeeklyWatchdogReport {
  const bySeverity = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0
  };

  for (const change of input.changes) {
    bySeverity[change.severity] += 1;
  }

  const highlights: string[] = [];

  if (input.health.completenessScore >= 90) {
    highlights.push("Profile completeness remains enterprise-grade (90+ score).");
  }

  if (input.health.missingCritical.length > 0) {
    highlights.push(`Critical gaps found: ${input.health.missingCritical.join(", ")}.`);
  }

  if (bySeverity.critical > 0) {
    highlights.push(`Detected ${bySeverity.critical} critical profile changes requiring operator review.`);
  }

  if (input.health.staleSignals.length > 0) {
    highlights.push(`Freshness decay signals: ${input.health.staleSignals.join(", ")}.`);
  }

  if (!highlights.length) {
    highlights.push("No urgent integrity risks detected in this window.");
  }

  return {
    generatedAt: new Date().toISOString(),
    locationName: input.currentSnapshot.locationName,
    health: input.health,
    changeSummary: {
      ...bySeverity,
      total: input.changes.length
    },
    highlights
  };
}
