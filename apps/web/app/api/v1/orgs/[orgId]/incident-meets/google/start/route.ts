import { NextRequest } from "next/server";
import { getRequestContext, hasRole } from "@/lib/auth";
import {
  buildIncidentMeetOAuthUrl
} from "@/lib/incident-meet";
import { fail, ok } from "@/lib/http";
import { isSupabaseConfigured } from "@/lib/supabase";

interface Params {
  params: { orgId: string };
}

export async function GET(request: NextRequest, { params }: Params) {
  const ctx = await getRequestContext(request);
  if (isSupabaseConfigured()) {
    if (!ctx.isAuthenticated) {
      return fail("Unauthorized", 401);
    }
    if (ctx.organizationId !== params.orgId) {
      return fail("Forbidden", 403);
    }
    if (!hasRole(ctx, "admin")) {
      return fail("Forbidden", 403);
    }
  }

  const oauthClientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const oauthClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!oauthClientId || !oauthClientSecret || !siteUrl) {
    return fail("Google OAuth environment is not configured", 503);
  }

  const returnPath = request.nextUrl.searchParams.get("returnPath") ?? "/dashboard/incidents";
  const redirectUri = `${siteUrl}/api/v1/incident-meets/google/callback`;
  const authUrl = buildIncidentMeetOAuthUrl({
    clientId: oauthClientId,
    redirectUri,
    state: {
      organizationId: params.orgId,
      userId: ctx.userId,
      returnPath
    }
  });

  return ok({ authUrl, redirectUri });
}
