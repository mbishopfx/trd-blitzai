import { buildGbpOAuthUrl } from "@trd-aiblitz/integrations-gbp";
import { NextRequest } from "next/server";
import { getRequestContext, hasRole } from "@/lib/auth";
import { resolveGoogleOAuthRedirectUri } from "@/lib/google-oauth";
import { fail, ok } from "@/lib/http";
import { isSupabaseConfigured } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const ctx = await getRequestContext(request);
  if (isSupabaseConfigured()) {
    if (!ctx.isAuthenticated) {
      return fail("Unauthorized", 401);
    }
    if (!hasRole(ctx, "operator")) {
      return fail("Forbidden", 403);
    }
  }

  const clientId = request.nextUrl.searchParams.get("clientId");
  const seedMode = request.nextUrl.searchParams.get("seedMode") === "true";
  const returnPath = request.nextUrl.searchParams.get("returnPath") ?? "/dashboard/clients";

  if (!clientId && !seedMode) {
    return fail("clientId query param is required unless seedMode=true", 400);
  }

  const oauthClientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const oauthClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();

  if (!oauthClientId || !oauthClientSecret) {
    return fail("GBP OAuth environment is not configured", 503);
  }

  const redirectUri = resolveGoogleOAuthRedirectUri({
    callbackPath: "/api/v1/gbp/oauth/callback",
    operation: "GBP authorization URL generation",
    envVarNames: ["GBP_GOOGLE_OAUTH_REDIRECT_URI", "GOOGLE_OAUTH_REDIRECT_URI"]
  });
  const authUrl = buildGbpOAuthUrl(
    {
      clientId: oauthClientId,
      clientSecret: oauthClientSecret,
      redirectUri
    },
    {
      organizationId: ctx.organizationId,
      clientId: clientId ?? "__seed_connector__",
      userId: ctx.userId,
      returnPath
    }
  );

  return ok({ authUrl, redirectUri });
}
