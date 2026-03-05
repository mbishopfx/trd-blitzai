import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { GbpApiClient, refreshAccessToken, type GbpLocation } from "@trd-aiblitz/integrations-gbp";
import { decryptJsonToken, encryptJsonToken } from "../apps/worker-ts/src/crypto";

interface CliOptions {
  organizationId: string;
  seedClientId: string;
  timezone: string;
  dryRun: boolean;
  maxLocations: number | null;
}

interface SeedConnection {
  id: string;
  organization_id: string;
  client_id: string;
  provider: string;
  provider_account_id: string;
  encrypted_token_payload: Record<string, unknown>;
  scopes: string[];
  metadata: Record<string, unknown>;
  token_expires_at: string | null;
}

interface TokenPayload {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

function usage(): never {
  console.error(
    [
      "Usage:",
      "  npx tsx scripts/seed-gbp-clients.ts --org-id <ORG_UUID> --seed-client-id <CLIENT_UUID> [--timezone America/Chicago] [--max-locations 200] [--dry-run]",
      "",
      "Required env:",
      "  SUPABASE_URL",
      "  SUPABASE_SERVICE_ROLE_KEY",
      "  GOOGLE_OAUTH_CLIENT_ID",
      "  GOOGLE_OAUTH_CLIENT_SECRET",
      "  NEXT_PUBLIC_SITE_URL",
      "  APP_ENCRYPTION_KEY (required when tokens are encrypted)"
    ].join("\n")
  );
  process.exit(1);
}

function parseArgs(argv: string[]): CliOptions {
  const map = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--")) {
      continue;
    }
    const key = item.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      map.set(key, true);
      continue;
    }
    map.set(key, next);
    i += 1;
  }

  const organizationId = String(map.get("org-id") ?? "");
  const seedClientId = String(map.get("seed-client-id") ?? "");
  const timezone = String(map.get("timezone") ?? "America/Chicago");
  const dryRun = map.get("dry-run") === true;
  const maxLocationsRaw = map.get("max-locations");
  const maxLocations =
    typeof maxLocationsRaw === "string" && Number.isFinite(Number(maxLocationsRaw))
      ? Math.max(1, Number(maxLocationsRaw))
      : null;

  if (!organizationId || !seedClientId) {
    usage();
  }

  return {
    organizationId,
    seedClientId,
    timezone,
    dryRun,
    maxLocations
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function locationIdFromName(locationName: string): string {
  return locationName.replace(/^locations\//, "");
}

function accountIdFromName(accountName: string): string {
  return accountName.replace(/^accounts\//, "");
}

function requiresRefresh(token: TokenPayload): boolean {
  const ms = new Date(token.expiresAt).getTime();
  if (Number.isNaN(ms)) {
    return false;
  }
  return ms - Date.now() < 2 * 60 * 1000;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function toTokenPayload(encryptedPayload: Record<string, unknown>): TokenPayload {
  const tokenBlob = encryptedPayload.token;
  if (typeof tokenBlob !== "string" || !tokenBlob) {
    throw new Error("Seed connection is missing encrypted token payload.token");
  }

  const parsed = decryptJsonToken(tokenBlob);
  const accessToken = typeof parsed.accessToken === "string" ? parsed.accessToken : "";
  const refreshToken = typeof parsed.refreshToken === "string" ? parsed.refreshToken : "";
  const expiresAt = typeof parsed.expiresAt === "string" ? parsed.expiresAt : "";

  if (!accessToken || !refreshToken || !expiresAt) {
    throw new Error("Seed connection token payload is missing accessToken/refreshToken/expiresAt");
  }

  return { accessToken, refreshToken, expiresAt };
}

async function loadSeedConnection(supabase: SupabaseClient, options: CliOptions): Promise<SeedConnection> {
  const { data, error } = await supabase
    .from("integration_connections")
    .select(
      "id,organization_id,client_id,provider,provider_account_id,encrypted_token_payload,scopes,metadata,token_expires_at"
    )
    .eq("organization_id", options.organizationId)
    .eq("client_id", options.seedClientId)
    .eq("provider", "gbp")
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    throw new Error(
      `Unable to load seed GBP integration for client ${options.seedClientId}: ${error?.message ?? "not found"}`
    );
  }

  return data as SeedConnection;
}

async function maybeRefreshToken(
  supabase: SupabaseClient,
  connection: SeedConnection,
  token: TokenPayload,
  dryRun: boolean
): Promise<{ token: TokenPayload; encryptedTokenPayload: Record<string, unknown>; scopes: string[] }> {
  if (!requiresRefresh(token)) {
    return {
      token,
      encryptedTokenPayload: connection.encrypted_token_payload,
      scopes: connection.scopes ?? []
    };
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!clientId || !clientSecret || !siteUrl) {
    throw new Error("Missing GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / NEXT_PUBLIC_SITE_URL");
  }

  const refreshed = await refreshAccessToken(
    {
      clientId,
      clientSecret,
      redirectUri: `${siteUrl}/api/v1/gbp/oauth/callback`
    },
    token.refreshToken
  );

  const nextToken: TokenPayload = {
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    expiresAt: refreshed.expiresAt
  };
  const encrypted = {
    ...connection.encrypted_token_payload,
    token: encryptJsonToken(nextToken)
  };

  if (!dryRun) {
    const { error } = await supabase
      .from("integration_connections")
      .update({
        encrypted_token_payload: encrypted,
        token_expires_at: refreshed.expiresAt,
        last_refresh_at: nowIso(),
        scopes: refreshed.scopes.length ? refreshed.scopes : connection.scopes
      })
      .eq("id", connection.id);
    if (error) {
      throw new Error(`Failed to persist refreshed seed token: ${error.message}`);
    }
  }

  return {
    token: nextToken,
    encryptedTokenPayload: encrypted,
    scopes: refreshed.scopes.length ? refreshed.scopes : connection.scopes
  };
}

function buildClientName(location: GbpLocation, existingNames: Set<string>): string {
  const base = (location.title ?? "").trim() || `GBP ${locationIdFromName(location.name)}`;
  if (!existingNames.has(base.toLowerCase())) {
    existingNames.add(base.toLowerCase());
    return base;
  }

  let suffix = 2;
  while (existingNames.has(`${base} (${suffix})`.toLowerCase())) {
    suffix += 1;
  }
  const name = `${base} (${suffix})`;
  existingNames.add(name.toLowerCase());
  return name;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const supabaseUrl = process.env.SUPABASE_URL ?? "";
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!supabaseUrl || !serviceRole) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }

  const supabase = createClient(supabaseUrl, serviceRole, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  const seedConnection = await loadSeedConnection(supabase, options);
  const token = toTokenPayload(seedConnection.encrypted_token_payload);
  const refreshResult = await maybeRefreshToken(supabase, seedConnection, token, options.dryRun);

  const gbp = new GbpApiClient(refreshResult.token.accessToken);
  const accounts = await gbp.listAccounts();
  if (!accounts.length) {
    throw new Error("No GBP accounts returned for the connected OAuth user");
  }

  const { data: existingLocations, error: existingLocationsError } = await supabase
    .from("gbp_locations")
    .select("location_name,client_id")
    .eq("organization_id", options.organizationId);
  if (existingLocationsError) {
    throw new Error(`Failed to load existing gbp_locations: ${existingLocationsError.message}`);
  }
  const existingLocationNames = new Set((existingLocations ?? []).map((row) => String(row.location_name)));

  const { data: existingClients, error: existingClientsError } = await supabase
    .from("clients")
    .select("name")
    .eq("organization_id", options.organizationId);
  if (existingClientsError) {
    throw new Error(`Failed to load existing client names: ${existingClientsError.message}`);
  }
  const existingClientNames = new Set((existingClients ?? []).map((row) => String(row.name).toLowerCase()));

  let imported = 0;
  let skipped = 0;
  let scanned = 0;

  for (const account of accounts) {
    if (!account.name) {
      continue;
    }

    const locations = await gbp.listLocations(account.name);
    for (const location of locations) {
      scanned += 1;
      if (!location.name) {
        skipped += 1;
        continue;
      }
      if (options.maxLocations && scanned > options.maxLocations) {
        break;
      }
      if (existingLocationNames.has(location.name)) {
        skipped += 1;
        continue;
      }

      const clientName = buildClientName(location, existingClientNames);
      const metadata = {
        ...asRecord(seedConnection.metadata),
        accountName: account.name,
        locationName: location.name,
        locationId: locationIdFromName(location.name),
        source: "bulk_seed_v1",
        seededAt: nowIso(),
        seededFromClientId: seedConnection.client_id
      };

      if (options.dryRun) {
        imported += 1;
        continue;
      }

      const { data: clientRow, error: clientInsertError } = await supabase
        .from("clients")
        .insert({
          organization_id: options.organizationId,
          name: clientName,
          timezone: options.timezone,
          website_url: location.websiteUri ?? null,
          primary_location_label: location.title ?? location.name
        })
        .select("id")
        .single();
      if (clientInsertError || !clientRow) {
        throw new Error(`Failed creating client for ${location.name}: ${clientInsertError?.message ?? "unknown"}`);
      }

      const { data: connectionRow, error: connectionError } = await supabase
        .from("integration_connections")
        .insert({
          organization_id: options.organizationId,
          client_id: clientRow.id,
          provider: "gbp",
          provider_account_id: account.name,
          encrypted_token_payload: refreshResult.encryptedTokenPayload,
          scopes: refreshResult.scopes,
          metadata,
          token_expires_at: refreshResult.token.expiresAt,
          is_active: true
        })
        .select("id")
        .single();
      if (connectionError || !connectionRow) {
        throw new Error(
          `Failed creating GBP integration connection for ${location.name}: ${connectionError?.message ?? "unknown"}`
        );
      }

      const { error: locationInsertError } = await supabase.from("gbp_locations").insert({
        organization_id: options.organizationId,
        client_id: clientRow.id,
        integration_connection_id: connectionRow.id,
        account_name: account.name,
        account_id: accountIdFromName(account.name),
        location_name: location.name,
        location_id: locationIdFromName(location.name),
        title: location.title ?? null,
        storefront_address: location.storefrontAddress ?? null,
        primary_phone: location.phoneNumbers?.primaryPhone ?? location.primaryPhone ?? null,
        website_uri: location.websiteUri ?? null,
        metadata,
        last_synced_at: nowIso()
      });
      if (locationInsertError) {
        throw new Error(`Failed inserting gbp_locations row for ${location.name}: ${locationInsertError.message}`);
      }

      existingLocationNames.add(location.name);
      imported += 1;
    }
  }

  console.log(
    JSON.stringify(
      {
        dryRun: options.dryRun,
        organizationId: options.organizationId,
        seedClientId: options.seedClientId,
        accountsScanned: accounts.length,
        locationsScanned: scanned,
        clientsSeeded: imported,
        skippedExisting: skipped
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
