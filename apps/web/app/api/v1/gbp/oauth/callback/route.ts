import { decodeOAuthState, exchangeCodeForToken, GbpApiClient } from "@trd-aiblitz/integrations-gbp";
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

  let providerAccountId = `gbp-${state.clientId}`;
  const metadata: Record<string, unknown> = {
    connectedAt: new Date().toISOString()
  };

  try {
    const gbpClient = new GbpApiClient(tokenSet.accessToken);
    const accounts = await gbpClient.listAccounts();
    if (accounts.length > 0) {
      providerAccountId = accounts[0].name;
      metadata.accountName = accounts[0].name;
      metadata.accountCount = accounts.length;
      metadata.accounts = accounts.slice(0, 25).map((account) => ({
        name: account.name,
        accountName: account.accountName ?? null,
        type: account.type ?? null
      }));
    } else {
      metadata.accountCount = 0;
    }
  } catch (error) {
    metadata.accountDiscoveryError = error instanceof Error ? error.message : String(error);
  }

  await connectIntegration({
    organizationId: state.organizationId,
    clientId: state.clientId,
    provider: "gbp",
    providerAccountId,
    scopes: tokenSet.scopes,
    encryptedTokenPayload: {
      token: encryptJson({
        accessToken: tokenSet.accessToken,
        refreshToken: tokenSet.refreshToken,
        expiresAt: tokenSet.expiresAt
      })
    },
    metadata,
    tokenExpiresAt: tokenSet.expiresAt
  });

  const url = new URL(state.returnPath, siteUrl);
  url.searchParams.set("gbp_connected", "true");
  return NextResponse.redirect(url);
}
