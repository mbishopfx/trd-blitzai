import type { BlitzPhase } from "@trd-aiblitz/domain";
import type { ActionPlanner, PlannedAction } from "./types";

function baseAction(
  phase: BlitzPhase,
  actionType: PlannedAction["actionType"],
  riskTier: PlannedAction["riskTier"],
  payload: Record<string, unknown>,
  extra?: Partial<PlannedAction>
): PlannedAction {
  return {
    phase,
    actionType,
    riskTier,
    actor: "system",
    payload,
    ...extra
  };
}

export class DefaultBlitzPlanner implements ActionPlanner {
  async planPhase(input: Parameters<ActionPlanner["planPhase"]>[0]): Promise<PlannedAction[]> {
    const now = new Date().toISOString();

    switch (input.phase) {
      case "preflight":
        return [
          baseAction("preflight", "profile_patch", "low", {
            objective: "integration_health_check",
            includeQuotaValidation: true,
            includeTokenFreshness: true,
            includePolicyValidation: true,
            requestedAt: now
          })
        ];
      case "completeness":
        return [
          baseAction("completeness", "attribute_update", "medium", {
            objective: "competitor_benchmark_and_gap_matrix",
            fields: ["categories", "services", "attributes", "hours", "profile", "website"]
          }),
          baseAction("completeness", "profile_patch", "medium", {
            objective: "ai_description_qna_optimization",
            model: "gemini"
          }),
          baseAction("completeness", "attribute_update", "medium", {
            objective: "auto_fill_profile_fields",
            applyRecommendations: true
          })
        ];
      case "media":
        return [
          baseAction("media", "media_upload", "low", {
            objective: "media_derivative_batch_upload",
            batchSize: 12,
            targetAssets: 50,
            includeGeoTags: true,
            includeStories: true,
            includeVideos: true,
            includeVirtualTours: true,
            enableVision: true
          })
        ];
      case "content":
        return [
          baseAction("content", "post_publish", "medium", {
            objective: "geo_content_burst",
            postCount: 10,
            cadence: "initial"
          }),
          baseAction("content", "post_publish", "medium", {
            objective: "schedule_follow_up_posts",
            cadence: "jittered",
            windows: ["+2d", "+4d", "+7d"]
          })
        ];
      case "reviews":
        return [
          baseAction(
            "reviews",
            "review_reply",
            "high",
            {
              objective: "auto_reply_all_pending_reviews",
              includeLowAndHighRatings: true
            },
            { isReviewActionForAllRatings: true }
          )
        ];
      case "interaction":
        return [
          baseAction("interaction", "hours_update", "medium", {
            objective: "cta_and_timing_optimizer",
            includeHoursAdjustment: true
          })
        ];
      case "postcheck":
        return [
          baseAction("postcheck", "profile_patch", "low", {
            objective: "delta_snapshot_and_report",
            includeAutopilotScheduling: true
          })
        ];
      default:
        return [];
    }
  }
}
