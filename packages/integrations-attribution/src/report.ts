import type { BlendedDailyMetric, BlitzImpactSummary } from "./contracts";

export interface BlitzImpactPanel {
  summary: BlitzImpactSummary;
  lift: {
    conversionDelta: number;
    spendDelta: number;
    directionalLiftPct: number;
  };
  efficiency: {
    blendedCostPerResult: number;
    blendedReturnOnAdSpend: number;
  };
}

export function buildBlitzImpactPanel(summary: BlitzImpactSummary, blendedDaily: BlendedDailyMetric[]): BlitzImpactPanel {
  const totalValue = blendedDaily.reduce((acc, row) => acc + row.conversionValue, 0);

  return {
    summary,
    lift: {
      conversionDelta: summary.currentConversions - summary.baselineConversions,
      spendDelta: summary.currentSpend - summary.baselineSpend,
      directionalLiftPct: summary.directionalLiftPct
    },
    efficiency: {
      blendedCostPerResult: summary.blendedCostPerResult,
      blendedReturnOnAdSpend: summary.currentSpend > 0 ? totalValue / summary.currentSpend : 0
    }
  };
}
