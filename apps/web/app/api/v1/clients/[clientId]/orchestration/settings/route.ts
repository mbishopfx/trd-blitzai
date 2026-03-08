import { upsertClientOrchestrationSettingsSchema } from "@trd-aiblitz/domain";
import { NextRequest } from "next/server";
import { getRequestContext, hasRole } from "@/lib/auth";
import {
  getClientById,
  getClientOrchestrationSettings,
  upsertClientOrchestrationSettings
} from "@/lib/control-plane-store";
import { fail, ok } from "@/lib/http";
import { isSupabaseConfigured } from "@/lib/supabase";

interface Params {
  params: { clientId: string };
}

const HARDCODED_POSTS_PER_DAY = 2;
const HARDCODED_POST_DAYS_PER_WEEK = 3;
const HARDCODED_POSTS_PER_WEEK = HARDCODED_POSTS_PER_DAY * HARDCODED_POST_DAYS_PER_WEEK;

export async function GET(request: NextRequest, { params }: Params) {
  const ctx = await getRequestContext(request);
  if (isSupabaseConfigured()) {
    if (!ctx.isAuthenticated) {
      return fail("Unauthorized", 401);
    }
    if (!hasRole(ctx, "analyst")) {
      return fail("Forbidden", 403);
    }
  }

  const client = await getClientById(params.clientId);
  if (!client) {
    return fail("Client not found", 404);
  }
  if (isSupabaseConfigured() && client.organizationId !== ctx.organizationId) {
    return fail("Forbidden", 403);
  }

  return ok({ settings: await getClientOrchestrationSettings(params.clientId) });
}

export async function POST(request: NextRequest, { params }: Params) {
  const ctx = await getRequestContext(request);
  if (isSupabaseConfigured()) {
    if (!ctx.isAuthenticated) {
      return fail("Unauthorized", 401);
    }
    if (!hasRole(ctx, "admin")) {
      return fail("Forbidden", 403);
    }
  }

  const client = await getClientById(params.clientId);
  if (!client) {
    return fail("Client not found", 404);
  }
  if (isSupabaseConfigured() && client.organizationId !== ctx.organizationId) {
    return fail("Forbidden", 403);
  }

  const body = await request.json().catch(() => null);
  const parsed = upsertClientOrchestrationSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid orchestration settings payload", 400, parsed.error.flatten());
  }

  const settings = await upsertClientOrchestrationSettings(params.clientId, {
    tone: parsed.data.tone,
    objectives: parsed.data.objectives,
    photoAssetUrls: parsed.data.photoAssetUrls,
    photoAssetIds: parsed.data.photoAssetIds,
    sitemapUrl: parsed.data.sitemapUrl,
    defaultPostUrl: parsed.data.defaultPostUrl,
    reviewReplyStyle: parsed.data.reviewReplyStyle,
    postFrequencyPerWeek: HARDCODED_POSTS_PER_WEEK,
    postWordCountMin: parsed.data.postWordCountMin,
    postWordCountMax: parsed.data.postWordCountMax,
    eeatStructuredSnippetEnabled: parsed.data.eeatStructuredSnippetEnabled,
    metadata: {
      ...parsed.data.metadata,
      postingCadence: {
        postsPerDay: HARDCODED_POSTS_PER_DAY,
        postingDaysPerWeek: HARDCODED_POST_DAYS_PER_WEEK,
        postsPerWeek: HARDCODED_POSTS_PER_WEEK,
        locked: true,
        source: "platform_hardcoded_rule"
      }
    }
  });

  return ok({ settings });
}
