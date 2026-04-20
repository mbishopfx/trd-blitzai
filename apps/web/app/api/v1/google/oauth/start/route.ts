import { NextRequest } from "next/server";
import { getRequestContext, hasRole } from "@/lib/auth";
import { buildGoogleOAuthUrl, resolveGoogleOAuthRedirectUri, type GoogleIntegrationProvider } from "@/lib/google-oauth";
import { fail, ok } from "@/lib/http";
import { isSupabaseConfigured } from "@/lib/supabase";

const allowedProviders = new Set<GoogleIntegrationProvider>(["ga4", "google_ads", "search_console"]);

export async function GET(request: NextRequest) {
  const ctx = await getRequestContext(request);
  if (isSupabaseConfigured()) {
    if (!ctx.isAuthenticated) {
      return fail("Unauthorized", 401);
    }
    if (!hasRole(ctx, "admin")) {
      return fail("Forbidden", 403);
    }
  }

  const providerRaw = request.nextUrl.searchParams.get("provider");
  const clientId = request.nextUrl.searchParams.get("clientId");
  const providerAccountId = request.nextUrl.searchParams.get("providerAccountId") ?? "";
  const returnPath = request.nextUrl.searchParams.get("returnPath") ?? `/dashboard/clients/${clientId ?? ""}/settings`;

  if (!providerRaw || !allowedProviders.has(providerRaw as GoogleIntegrationProvider)) {
    return fail("provider query param must be one of ga4, google_ads, search_console", 400);
  }
  if (!clientId) {
    return fail("clientId query param is required", 400);
  }

  const oauthClientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const oauthClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!oauthClientId || !oauthClientSecret) {
    return fail("Google OAuth environment is not configured", 503);
  }

  const redirectUri = resolveGoogleOAuthRedirectUri({
    callbackPath: "/api/v1/google/oauth/callback",
    operation: "google integration authorization URL generation",
    envVarNames: ["GOOGLE_INTEGRATION_OAUTH_REDIRECT_URI"]
  });
  const authUrl = buildGoogleOAuthUrl({
    clientId: oauthClientId,
    redirectUri,
    state: {
      provider: providerRaw as GoogleIntegrationProvider,
      organizationId: ctx.organizationId,
      clientId,
      providerAccountId: providerAccountId.trim(),
      userId: ctx.userId,
      returnPath
    }
  });

  return ok({ authUrl, redirectUri });
}
