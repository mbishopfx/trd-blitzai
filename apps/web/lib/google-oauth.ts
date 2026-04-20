import { Buffer } from "node:buffer";

export type GoogleIntegrationProvider = "ga4" | "google_ads" | "search_console";

export interface GoogleOAuthState {
  provider: GoogleIntegrationProvider;
  organizationId: string;
  clientId: string;
  providerAccountId: string;
  userId: string;
  returnPath: string;
}

export interface GoogleTokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  scopes: string[];
  tokenType: string;
}

const GOOGLE_OAUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

const PROVIDER_SCOPES: Record<GoogleIntegrationProvider, string[]> = {
  ga4: [
    "https://www.googleapis.com/auth/analytics.readonly",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile"
  ],
  google_ads: [
    "https://www.googleapis.com/auth/adwords",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile"
  ],
  search_console: [
    "https://www.googleapis.com/auth/webmasters.readonly",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile"
  ]
};

function requireRedirectUri(redirectUri: string | null | undefined, operation: string): string {
  const normalized = redirectUri?.trim();
  if (!normalized) {
    throw new Error(`Google OAuth redirect URI is required for ${operation}`);
  }
  return normalized;
}

export function resolveGoogleOAuthRedirectUri(input: {
  callbackPath: string;
  operation: string;
  envVarNames?: string[];
}): string {
  for (const envVarName of input.envVarNames ?? []) {
    const configured = process.env[envVarName]?.trim();
    if (configured) {
      return configured;
    }
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!siteUrl) {
    throw new Error(`Google OAuth redirect URI is required for ${input.operation}`);
  }

  return new URL(input.callbackPath, siteUrl).toString();
}

export function encodeGoogleOAuthState(state: GoogleOAuthState): string {
  return Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
}

export function decodeGoogleOAuthState(value: string): GoogleOAuthState {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as GoogleOAuthState;
}

export function buildGoogleOAuthUrl(input: {
  clientId: string;
  redirectUri: string;
  state: GoogleOAuthState;
}): string {
  const url = new URL(GOOGLE_OAUTH_BASE);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", requireRedirectUri(input.redirectUri, "authorization URL generation"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", PROVIDER_SCOPES[input.state.provider].join(" "));
  url.searchParams.set("state", encodeGoogleOAuthState(input.state));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent select_account");
  return url.toString();
}

export async function exchangeGoogleCodeForToken(input: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}): Promise<GoogleTokenSet> {
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: requireRedirectUri(input.redirectUri, "authorization code exchange"),
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

export async function refreshGoogleAccessToken(input: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<GoogleTokenSet> {
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      refresh_token: input.refreshToken,
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
    refreshToken: input.refreshToken,
    expiresAt: new Date(Date.now() + payload.expires_in * 1000).toISOString(),
    scopes: (payload.scope ?? "").split(" ").filter(Boolean),
    tokenType: payload.token_type ?? "Bearer"
  };
}
