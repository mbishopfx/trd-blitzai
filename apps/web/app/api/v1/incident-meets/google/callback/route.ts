import { NextRequest, NextResponse } from "next/server";
import { upsertIncidentMeetConnection } from "@/lib/control-plane-store";
import { exchangeGoogleCodeForToken } from "@/lib/google-oauth";
import {
  decodeIncidentMeetState,
  encodeStoredGoogleToken,
  fetchGoogleAccountEmail,
  INCIDENT_MEET_SENDER_EMAIL
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
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!oauthClientId || !oauthClientSecret || !siteUrl) {
    return fail("Google OAuth environment is not configured", 503);
  }

  const state = decodeIncidentMeetState(stateRaw);
  const redirectUri = `${siteUrl}/api/v1/incident-meets/google/callback`;
  const tokenSet = await exchangeGoogleCodeForToken({
    clientId: oauthClientId,
    clientSecret: oauthClientSecret,
    redirectUri,
    code
  });

  const senderEmail = (await fetchGoogleAccountEmail(tokenSet.accessToken)).toLowerCase();
  const redirectUrl = new URL(state.returnPath, siteUrl);

  if (senderEmail !== INCIDENT_MEET_SENDER_EMAIL) {
    redirectUrl.searchParams.set("incident_meet_error", `Connect ${INCIDENT_MEET_SENDER_EMAIL} to use incident meetings.`);
    return NextResponse.redirect(redirectUrl);
  }

  await upsertIncidentMeetConnection({
    organizationId: state.organizationId,
    senderEmail,
    encryptedTokenPayload: encodeStoredGoogleToken({
      accessToken: tokenSet.accessToken,
      refreshToken: tokenSet.refreshToken,
      expiresAt: tokenSet.expiresAt
    }),
    scopes: tokenSet.scopes,
    metadata: {
      provider: "google_calendar",
      connectedAt: new Date().toISOString()
    },
    tokenExpiresAt: tokenSet.expiresAt
  });

  redirectUrl.searchParams.set("incident_meet_connected", "true");
  return NextResponse.redirect(redirectUrl);
}
