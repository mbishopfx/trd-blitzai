import { buildGbpOAuthUrl } from "@trd-aiblitz/integrations-gbp";
import { NextRequest } from "next/server";
import { getRequestContext } from "@/lib/auth";
import { fail, ok } from "@/lib/http";

export async function GET(request: NextRequest) {
  const ctx = getRequestContext(request);
  const clientId = request.nextUrl.searchParams.get("clientId");
  const returnPath = request.nextUrl.searchParams.get("returnPath") ?? "/dashboard/blitz";

  if (!clientId) {
    return fail("clientId query param is required", 400);
  }

  const oauthClientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const oauthClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

  if (!oauthClientId || !oauthClientSecret || !siteUrl) {
    return fail("GBP OAuth environment is not configured", 503);
  }

  const redirectUri = `${siteUrl}/api/v1/gbp/oauth/callback`;
  const authUrl = buildGbpOAuthUrl(
    {
      clientId: oauthClientId,
      clientSecret: oauthClientSecret,
      redirectUri
    },
    {
      organizationId: ctx.organizationId,
      clientId,
      userId: ctx.userId,
      returnPath
    }
  );

  return ok({ authUrl, redirectUri });
}
