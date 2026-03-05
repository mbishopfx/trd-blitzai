import { Buffer } from "node:buffer";
import type { GbpApiConfig, GbpOAuthState, GbpTokenSet } from "./types";

const GOOGLE_OAUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

const DEFAULT_SCOPES = [
  "https://www.googleapis.com/auth/business.manage",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile"
];

function requireRedirectUri(config: GbpApiConfig, operation: string): string {
  const redirectUri = config.redirectUri?.trim();
  if (!redirectUri) {
    throw new Error(`Google OAuth redirect URI is required for ${operation}`);
  }
  return redirectUri;
}

export function encodeOAuthState(state: GbpOAuthState): string {
  return Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
}

export function decodeOAuthState(value: string): GbpOAuthState {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as GbpOAuthState;
}

export function buildGbpOAuthUrl(config: GbpApiConfig, state: GbpOAuthState): string {
  const redirectUri = requireRedirectUri(config, "authorization URL generation");
  const url = new URL(GOOGLE_OAUTH_BASE);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", DEFAULT_SCOPES.join(" "));
  url.searchParams.set("state", encodeOAuthState(state));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent select_account");
  return url.toString();
}

export async function exchangeCodeForToken(config: GbpApiConfig, code: string): Promise<GbpTokenSet> {
  const redirectUri = requireRedirectUri(config, "authorization code exchange");
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code"
    })
  });

  if (!response.ok) {
    throw new Error(`OAuth token exchange failed (${response.status})`);
  }

  const payload = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope?: string;
    token_type?: string;
  };

  if (!payload.access_token || !payload.refresh_token) {
    throw new Error("OAuth token exchange returned incomplete payload");
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: new Date(Date.now() + payload.expires_in * 1000).toISOString(),
    scopes: (payload.scope ?? "").split(" ").filter(Boolean),
    tokenType: payload.token_type ?? "Bearer"
  };
}

export async function refreshAccessToken(config: GbpApiConfig, refreshToken: string): Promise<GbpTokenSet> {
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    })
  });

  if (!response.ok) {
    throw new Error(`OAuth refresh failed (${response.status})`);
  }

  const payload = (await response.json()) as {
    access_token: string;
    expires_in: number;
    scope?: string;
    token_type?: string;
  };

  return {
    accessToken: payload.access_token,
    refreshToken,
    expiresAt: new Date(Date.now() + payload.expires_in * 1000).toISOString(),
    scopes: (payload.scope ?? "").split(" ").filter(Boolean),
    tokenType: payload.token_type ?? "Bearer"
  };
}
