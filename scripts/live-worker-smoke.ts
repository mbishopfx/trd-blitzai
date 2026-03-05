import { BlitzRunOrchestrator } from "../apps/worker-ts/src/orchestrator";
import { LogEventPublisher } from "../apps/worker-ts/src/event-bus";
import { GbpLiveActionExecutor } from "../apps/worker-ts/src/executors/gbp-live";
import { SupabaseBlitzRepository } from "../apps/worker-ts/src/repository/supabase";
import { getSupabaseServiceClient, isSupabaseConfigured } from "../apps/worker-ts/src/supabase";
import type { BlitzActionType, BlitzAutopilotPolicy, BlitzPhase, BlitzRun, RiskTier } from "@trd-aiblitz/domain";
import type { ActionPlanner, PlannedAction } from "../apps/worker-ts/src/types";

function argValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return null;
  }
  return process.argv[index + 1] ?? null;
}

async function resolveTargetClient(explicitClientId: string | null): Promise<{ organizationId: string; clientId: string }> {
  const supabase = getSupabaseServiceClient();

  if (explicitClientId) {
    const { data, error } = await supabase
      .from("clients")
      .select("id,organization_id")
      .eq("id", explicitClientId)
      .maybeSingle();
    if (error || !data) {
      throw new Error(`Unable to resolve client ${explicitClientId}: ${error?.message ?? "not found"}`);
    }

    return {
      organizationId: String(data.organization_id),
      clientId: String(data.id)
    };
  }

  const { data, error } = await supabase
    .from("integration_connections")
    .select("organization_id,client_id")
    .eq("provider", "gbp")
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) {
    throw new Error(`No active GBP integration found for smoke test: ${error?.message ?? "none found"}`);
  }

  return {
    organizationId: String(data.organization_id),
    clientId: String(data.client_id)
  };
}

async function createRun(input: { organizationId: string; clientId: string }): Promise<string> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("blitz_runs")
    .insert({
      organization_id: input.organizationId,
      client_id: input.clientId,
      status: "created",
      triggered_by: "live-worker-smoke",
      policy_snapshot: {
        source: "live-worker-smoke",
        requestedAt: new Date().toISOString()
      }
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create smoke run: ${error?.message ?? "unknown error"}`);
  }

  return String(data.id);
}

class MinimalLiveSmokePlanner implements ActionPlanner {
  private action(
    phase: BlitzPhase,
    actionType: BlitzActionType,
    riskTier: RiskTier,
    payload: Record<string, unknown>
  ): PlannedAction {
    return {
      phase,
      actionType,
      riskTier,
      actor: "system",
      payload
    };
  }

  async planPhase(input: { run: BlitzRun; phase: BlitzPhase; policy: BlitzAutopilotPolicy }): Promise<PlannedAction[]> {
    switch (input.phase) {
      case "preflight":
        return [this.action("preflight", "profile_patch", "low", { objective: "integration_health_check" })];
      case "completeness":
        return [this.action("completeness", "attribute_update", "medium", { objective: "completeness_gap_matrix" })];
      case "media":
        return [this.action("media", "media_upload", "low", { objective: "media_derivative_batch_upload" })];
      case "content":
        return [this.action("content", "post_publish", "medium", { objective: "geo_content_burst", postCount: 1 })];
      case "reviews":
        return [this.action("reviews", "review_reply", "high", { objective: "auto_reply_pending_reviews", maxReplies: 1 })];
      case "interaction":
        return [this.action("interaction", "hours_update", "medium", { objective: "cta_and_timing_optimizer" })];
      case "postcheck":
        return [this.action("postcheck", "profile_patch", "low", { objective: "delta_snapshot_and_report" })];
      default:
        return [];
    }
  }
}

async function main(): Promise<void> {
  if (!isSupabaseConfigured()) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }

  const explicitClientId = argValue("--client");
  const target = await resolveTargetClient(explicitClientId);
  const runId = await createRun(target);

  console.log(`[smoke] Created run ${runId} for client ${target.clientId}`);

  const repository = new SupabaseBlitzRepository(getSupabaseServiceClient());
  const orchestrator = new BlitzRunOrchestrator({
    repository,
    planner: new MinimalLiveSmokePlanner(),
    executor: new GbpLiveActionExecutor({ repository }),
    events: new LogEventPublisher(),
    options: {
      maxActionRetries: 2,
      maxCriticalFailuresBeforeRollback: 2,
      defaultThrottleMs: 0
    }
  });

  const completedRun = await orchestrator.executeRun(runId);
  const actions = await repository.listActions(runId);

  const counts = actions.reduce(
    (acc, action) => {
      acc[action.status] = (acc[action.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  console.log(`[smoke] Completed run ${runId} with status ${completedRun.status}`);
  console.log(`[smoke] Action status counts: ${JSON.stringify(counts)}`);
}

main().catch((error) => {
  console.error(`[smoke] Failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
