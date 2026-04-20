import { NextRequest, NextResponse } from "next/server";
import { upsertIncidentMeetConnection } from "@/lib/control-plane-store";
import { exchangeGoogleCodeForToken, resolveGoogleOAuthRedirectUri } from "@/lib/google-oauth";
import {
  decodeIncidentMeetState,
  encodeStoredGoogleToken,
  fetchGoogleAccountEmail
} from "@/lib/incident-meet";
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

  const oauthClientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const oauthClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!oauthClientId || !oauthClientSecret) {
    return fail("Google OAuth environment is not configured", 503);
  }

  const state = decodeIncidentMeetState(stateRaw);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!siteUrl) {
    return fail("Google OAuth environment is not configured", 503);
  }
  const redirectUri = resolveGoogleOAuthRedirectUri({
    callbackPath: "/api/v1/incident-meets/google/callback",
    operation: "incident meet authorization code exchange",
    envVarNames: ["INCIDENT_MEET_GOOGLE_OAUTH_REDIRECT_URI"]
  });
  const tokenSet = await exchangeGoogleCodeForToken({
    clientId: oauthClientId,
    clientSecret: oauthClientSecret,
    redirectUri,
    code
  });

  const senderEmail = (await fetchGoogleAccountEmail(tokenSet.accessToken)).toLowerCase();
  const redirectUrl = new URL(state.returnPath, siteUrl);

  await upsertIncidentMeetConnection({
    organizationId: state.organizationId,
    userId: state.userId,
    senderEmail,
    encryptedTokenPayload: encodeStoredGoogleToken({
      accessToken: tokenSet.accessToken,
      refreshToken: tokenSet.refreshToken,
      expiresAt: tokenSet.expiresAt
    }),
    scopes: tokenSet.scopes,
    metadata: {
      provider: "google_calendar",
      connectedByUserId: state.userId,
      connectedAt: new Date().toISOString()
    },
    tokenExpiresAt: tokenSet.expiresAt
  });

  redirectUrl.searchParams.set("incident_meet_connected", "true");
  return NextResponse.redirect(redirectUrl);
}
