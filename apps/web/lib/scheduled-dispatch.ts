import { GbpLiveActionExecutor } from "@trd-aiblitz/worker-ts/src/executors/gbp-live";
import { SupabaseBlitzRepository } from "@trd-aiblitz/worker-ts/src/repository/supabase";
import {
  dispatchDueContentArtifactsOnce,
  type ScheduledDispatchSummary
} from "@trd-aiblitz/worker-ts/src/scheduled-content";
import { getSupabaseServiceClient, isSupabaseConfigured } from "@/lib/supabase";

export async function dispatchDueContentArtifactsFromWeb(batchSize = 8): Promise<ScheduledDispatchSummary> {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase service credentials are not configured for web fallback dispatch.");
  }

  const repository = new SupabaseBlitzRepository(getSupabaseServiceClient());
  const executor = new GbpLiveActionExecutor({ repository });
  return dispatchDueContentArtifactsOnce({
    repository,
    executor,
    batchSize,
    source: "web-post-tool-fallback"
  });
}
