import { decodeOAuthState, exchangeCodeForToken, GbpApiClient } from "@trd-aiblitz/integrations-gbp";
import { NextRequest, NextResponse } from "next/server";
import { connectIntegration, createClient } from "@/lib/control-plane-store";
import { encryptJson } from "@/lib/crypto";
import { fail } from "@/lib/http";
import { getSupabaseServiceClient } from "@/lib/supabase";

function locationIdFromName(locationName: string): string {
  return locationName.replace(/^locations\//, "");
}

function accountIdFromName(accountName: string): string {
  return accountName.replace(/^accounts\//, "");
}

function buildUniqueClientName(base: string, existingNames: Set<string>): string {
  const normalizedBase = base.trim() || "GBP Client";
  if (!existingNames.has(normalizedBase.toLowerCase())) {
    existingNames.add(normalizedBase.toLowerCase());
    return normalizedBase;
  }

  let suffix = 2;
  while (existingNames.has(`${normalizedBase} (${suffix})`.toLowerCase())) {
    suffix += 1;
  }
  const candidate = `${normalizedBase} (${suffix})`;
  existingNames.add(candidate.toLowerCase());
  return candidate;
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
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
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

  const seedConnection = await connectIntegration({
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

  let seededClients = 0;
  let skippedLocations = 0;
  let seedError: string | null = null;

  try {
    const gbpClient = new GbpApiClient(tokenSet.accessToken);
    const accounts = await gbpClient.listAccounts();
    const supabase = getSupabaseServiceClient();

    const { data: existingLocationRows, error: existingLocationsError } = await supabase
      .from("gbp_locations")
      .select("location_name")
      .eq("organization_id", state.organizationId);
    if (existingLocationsError) {
      throw new Error(`Failed to read existing GBP locations: ${existingLocationsError.message}`);
    }
    const existingLocationNames = new Set((existingLocationRows ?? []).map((row) => String(row.location_name)));

    const { data: existingClientRows, error: existingClientError } = await supabase
      .from("clients")
      .select("name")
      .eq("organization_id", state.organizationId);
    if (existingClientError) {
      throw new Error(`Failed to read existing clients: ${existingClientError.message}`);
    }
    const existingClientNames = new Set((existingClientRows ?? []).map((row) => String(row.name).toLowerCase()));

    for (const account of accounts) {
      if (!account.name) {
        continue;
      }
      const locations = await gbpClient.listLocations(account.name);
      for (const location of locations) {
        if (!location.name) {
          skippedLocations += 1;
          continue;
        }
        if (existingLocationNames.has(location.name)) {
          skippedLocations += 1;
          continue;
        }

        const clientName = buildUniqueClientName(
          location.title?.trim() || `GBP ${locationIdFromName(location.name)}`,
          existingClientNames
        );
        const client = await createClient({
          organizationId: state.organizationId,
          name: clientName,
          timezone: "America/Chicago",
          websiteUrl: location.websiteUri ?? undefined,
          primaryLocationLabel: location.title ?? location.name
        });

        const locationMetadata: Record<string, unknown> = {
          accountName: account.name,
          locationName: location.name,
          locationId: locationIdFromName(location.name),
          seededAt: new Date().toISOString(),
          source: "oauth_auto_seed_v1",
          seededFromClientId: state.clientId
        };

        const scopedConnection = await connectIntegration({
          organizationId: state.organizationId,
          clientId: client.id,
          provider: "gbp",
          providerAccountId: account.name,
          scopes: tokenSet.scopes,
          encryptedTokenPayload: seedConnection.encryptedTokenPayload,
          metadata: locationMetadata,
          tokenExpiresAt: tokenSet.expiresAt
        });

        const { error: locationInsertError } = await supabase.from("gbp_locations").insert({
          organization_id: state.organizationId,
          client_id: client.id,
          integration_connection_id: scopedConnection.id,
          account_name: account.name,
          account_id: accountIdFromName(account.name),
          location_name: location.name,
          location_id: locationIdFromName(location.name),
          title: location.title ?? null,
          storefront_address: location.storefrontAddress ?? null,
          primary_phone: location.phoneNumbers?.primaryPhone ?? location.primaryPhone ?? null,
          website_uri: location.websiteUri ?? null,
          metadata: locationMetadata,
          last_synced_at: new Date().toISOString()
        });
        if (locationInsertError) {
          throw new Error(`Failed to insert gbp_locations row for ${location.name}: ${locationInsertError.message}`);
        }

        existingLocationNames.add(location.name);
        seededClients += 1;
      }
    }
  } catch (error) {
    seedError = error instanceof Error ? error.message : String(error);
  }

  const url = new URL(state.returnPath, siteUrl);
  url.searchParams.set("gbp_connected", "true");
  url.searchParams.set("seeded_clients", String(seededClients));
  url.searchParams.set("seeded_skipped", String(skippedLocations));
  if (seedError) {
    url.searchParams.set("gbp_seed_error", seedError.slice(0, 120));
  }
  return NextResponse.redirect(url);
}
