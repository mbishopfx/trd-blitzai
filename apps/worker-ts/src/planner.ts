import type { BlitzPhase } from "@trd-aiblitz/domain";
import type { ActionPlanner, PlannedAction } from "./types";

const HARDCODED_POSTS_PER_DAY = 2;
const HARDCODED_POST_DAYS_PER_WEEK = 3;
const HARDCODED_POSTS_PER_WEEK = HARDCODED_POSTS_PER_DAY * HARDCODED_POST_DAYS_PER_WEEK;
const HARDCODED_WEEKLY_WINDOWS = ["+1d@14:30", "+1d@19:00", "+3d@14:30", "+3d@19:00", "+5d@14:30", "+5d@19:00"];

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
            protocolMode: "72h_saturation",
            protocolStage: "day1",
            createFollowUpSchedule: true,
            batchSize: 3,
            targetAssets: 5,
            includeGeoTags: true,
            includeStories: true,
            includeVideos: true,
            includeVirtualTours: true,
            enableVision: true,
            minVisionQualityScore: 35,
            minServiceRelevanceScore: 45
          })
        ];
      case "content":
        return [
          baseAction("content", "post_publish", "medium", {
            objective: "geo_content_burst",
            postCount: HARDCODED_POSTS_PER_WEEK,
            cadence: "initial",
            postsPerDay: HARDCODED_POSTS_PER_DAY,
            postingDaysPerWeek: HARDCODED_POST_DAYS_PER_WEEK,
            archetypes: ["offer", "event", "proof", "did_you_know"],
            minQaPairs: 20,
            maxQaPairs: 24,
            qnaTarget: 24
          }),
          baseAction("content", "post_publish", "medium", {
            objective: "schedule_follow_up_posts",
            cadence: "hardcoded_weekly",
            windows: HARDCODED_WEEKLY_WINDOWS,
            postsPerDay: HARDCODED_POSTS_PER_DAY,
            postingDaysPerWeek: HARDCODED_POST_DAYS_PER_WEEK,
            followUpCount: HARDCODED_POSTS_PER_WEEK
          })
        ];
      case "reviews":
        return [];
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
