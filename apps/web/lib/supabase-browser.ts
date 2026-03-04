import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function readSupabaseUrl(): string | null {
  return process.env.NEXT_PUBLIC_SUPABASE_URL ?? null;
}

function readSupabaseAnonKey(): string | null {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? null;
}

export function isSupabaseBrowserConfigured(): boolean {
  return Boolean(readSupabaseUrl() && readSupabaseAnonKey());
}

let browserClient: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient {
  if (browserClient) {
    return browserClient;
  }

  const supabaseUrl = readSupabaseUrl();
  const supabaseAnonKey = readSupabaseAnonKey();
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase browser credentials are not configured");
  }

  browserClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });

  return browserClient;
}
