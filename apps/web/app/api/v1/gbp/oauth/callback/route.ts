import { decodeOAuthState, exchangeCodeForToken } from "@trd-aiblitz/integrations-gbp";
import { NextRequest, NextResponse } from "next/server";
import { connectIntegration } from "@/lib/control-plane-store";
import { encryptJson } from "@/lib/crypto";
import { fail } from "@/lib/http";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const stateRaw = request.nextUrl.searchParams.get("state");
  const oauthError = request.nextUrl.searchParams.get("error");

  if (oauthError) {
    return fail(`OAuth failed: ${oauthError}`, 400);
  }

  if (!code || !stateRaw) {
    return fail("OAuth callback missing code/state", 400);
  }

  const oauthClientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const oauthClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!oauthClientId || !oauthClientSecret || !siteUrl) {
    return fail("GBP OAuth environment is not configured", 503);
  }

  const state = decodeOAuthState(stateRaw);
  const redirectUri = `${siteUrl}/api/v1/gbp/oauth/callback`;

  const tokenSet = await exchangeCodeForToken(
    {
      clientId: oauthClientId,
      clientSecret: oauthClientSecret,
      redirectUri
    },
    code
  );

  connectIntegration({
    organizationId: state.organizationId,
    clientId: state.clientId,
    provider: "gbp",
    providerAccountId: `gbp-${state.clientId}`,
    scopes: tokenSet.scopes,
    encryptedTokenPayload: {
      token: encryptJson({
        accessToken: tokenSet.accessToken,
        refreshToken: tokenSet.refreshToken,
        expiresAt: tokenSet.expiresAt
      })
    }
  });

  const url = new URL(state.returnPath, siteUrl);
  url.searchParams.set("gbp_connected", "true");
  return NextResponse.redirect(url);
}
