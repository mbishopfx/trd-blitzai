import { NextRequest, NextResponse } from "next/server";
import { connectIntegration } from "@/lib/control-plane-store";
import { encryptJson } from "@/lib/crypto";
import {
  decodeGoogleOAuthState,
  exchangeGoogleCodeForToken,
  resolveGoogleOAuthRedirectUri,
  type GoogleIntegrationProvider
} from "@/lib/google-oauth";
import { fail } from "@/lib/http";

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

async function fetchJsonWithAccessToken<T>(url: string, accessToken: string, extraHeaders?: Record<string, string>): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...extraHeaders
    }
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

async function resolveProviderMetadata(
  provider: GoogleIntegrationProvider,
  accessToken: string
): Promise<{ providerAccountId: string | null; metadata: Record<string, unknown> }> {
  if (provider === "ga4") {
    try {
      const payload = await fetchJsonWithAccessToken<{
        accountSummaries?: Array<{
          account?: string;
          displayName?: string;
          propertySummaries?: Array<{ property?: string; displayName?: string; propertyType?: string }>;
        }>;
      }>("https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200", accessToken);
      const summaries = payload.accountSummaries ?? [];
      const properties = summaries.flatMap((summary) =>
        (summary.propertySummaries ?? []).map((property) => ({
          account: summary.account ?? null,
          accountDisplayName: summary.displayName ?? null,
          property: property.property ?? null,
          displayName: property.displayName ?? null,
          propertyType: property.propertyType ?? null
        }))
      );
      return {
        providerAccountId: properties[0]?.property?.replace(/^properties\//, "") ?? null,
        metadata: {
          accountSummaries: summaries.slice(0, 20),
          availableProperties: properties.slice(0, 100)
        }
      };
    } catch (error) {
      return {
        providerAccountId: null,
        metadata: {
          discoveryError: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }

  if (provider === "search_console") {
    try {
      const payload = await fetchJsonWithAccessToken<{
        siteEntry?: Array<{ siteUrl?: string; permissionLevel?: string }>;
      }>("https://www.googleapis.com/webmasters/v3/sites", accessToken);
      const properties = (payload.siteEntry ?? []).map((entry) => ({
        siteUrl: entry.siteUrl ?? null,
        permissionLevel: entry.permissionLevel ?? null
      }));
      return {
        providerAccountId: properties[0]?.siteUrl ?? null,
        metadata: {
          properties
        }
      };
    } catch (error) {
      return {
        providerAccountId: null,
        metadata: {
          discoveryError: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }

  try {
    const payload = await fetchJsonWithAccessToken<{
      resourceNames?: string[];
    }>("https://googleads.googleapis.com/v18/customers:listAccessibleCustomers", accessToken, {
      "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim() ?? ""
    });
    const customers = (payload.resourceNames ?? []).map((name) => name.replace(/^customers\//, ""));
    return {
      providerAccountId: customers[0] ?? null,
      metadata: {
        accessibleCustomers: customers
      }
    };
  } catch (error) {
    return {
      providerAccountId: null,
      metadata: {
        discoveryError: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

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

  const state = decodeGoogleOAuthState(stateRaw);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!siteUrl) {
    return fail("Google OAuth environment is not configured", 503);
  }
  const redirectUri = resolveGoogleOAuthRedirectUri({
    callbackPath: "/api/v1/google/oauth/callback",
    operation: "google integration authorization code exchange",
    envVarNames: ["GOOGLE_INTEGRATION_OAUTH_REDIRECT_URI"]
  });
  const tokenSet = await exchangeGoogleCodeForToken({
    clientId: oauthClientId,
    clientSecret: oauthClientSecret,
    redirectUri,
    code
  });

  const resolved = await resolveProviderMetadata(state.provider, tokenSet.accessToken);
  const metadata = {
    ...(resolved.metadata ?? {}),
    provider: state.provider,
    connectedAt: new Date().toISOString(),
    providerAccountId: state.providerAccountId || resolved.providerAccountId || null
  };

  const connection = await connectIntegration({
    organizationId: state.organizationId,
    clientId: state.clientId,
    provider: state.provider,
    providerAccountId: state.providerAccountId || resolved.providerAccountId || `${state.provider}-${state.clientId}`,
    scopes: tokenSet.scopes,
    encryptedTokenPayload: {
      token: encryptJson({
        accessToken: tokenSet.accessToken,
        refreshToken: tokenSet.refreshToken,
        expiresAt: tokenSet.expiresAt
      })
    },
    metadata: {
      ...metadata,
      oauth: {
        tokenType: tokenSet.tokenType
      }
    },
    tokenExpiresAt: tokenSet.expiresAt
  });

  const url = new URL(state.returnPath, siteUrl);
  url.searchParams.set(`${state.provider}_connected`, "true");
  url.searchParams.set(`${state.provider}_connection_id`, connection.id);
  return NextResponse.redirect(url);
}
