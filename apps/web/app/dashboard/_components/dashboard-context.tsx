"use client";

import type { Session } from "@supabase/supabase-js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import { getSupabaseBrowserClient, isSupabaseBrowserConfigured } from "@/lib/supabase-browser";

export type OrgRole = "owner" | "admin" | "operator" | "analyst" | "client_viewer";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  ownerEmail?: string;
  createdAt: string;
}

const roleValues: OrgRole[] = ["owner", "admin", "operator", "analyst", "client_viewer"];
const storageKey = "trd-aiblitz:dashboard-shell:v1";

interface RequestOptions {
  method?: string;
  body?: unknown;
}

interface DashboardContextValue {
  supabaseEnabled: boolean;
  session: Session | null;
  organizations: Organization[];
  selectedOrgId: string;
  role: OrgRole;
  apiKey: string;
  isHydrated: boolean;
  isBusy: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  setSelectedOrgId: (value: string) => void;
  setRole: (value: OrgRole) => void;
  setApiKey: (value: string) => void;
  buildAuthHeaders: (options?: { includeContentType?: boolean }) => Record<string, string>;
  request: <T>(path: string, options?: RequestOptions) => Promise<T>;
  reloadOrganizations: () => Promise<void>;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

export function DashboardProvider({ children }: { children: ReactNode }) {
  const supabaseEnabled = isSupabaseBrowserConfigured();
  const supabase = useMemo(
    () => (supabaseEnabled ? getSupabaseBrowserClient() : null),
    [supabaseEnabled]
  );

  const [isHydrated, setIsHydrated] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [role, setRole] = useState<OrgRole>("owner");
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw) as Partial<{
        selectedOrgId: string;
        role: OrgRole;
        apiKey: string;
      }>;

      if (parsed.selectedOrgId) {
        setSelectedOrgId(parsed.selectedOrgId);
      }
      if (parsed.apiKey) {
        setApiKey(parsed.apiKey);
      }
      if (parsed.role && roleValues.includes(parsed.role)) {
        setRole(parsed.role);
      }
    } catch {
      // Ignore malformed local storage payload.
    } finally {
      setIsHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!isHydrated || typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        selectedOrgId,
        role,
        apiKey
      })
    );
  }, [apiKey, isHydrated, role, selectedOrgId]);

  useEffect(() => {
    if (!supabase) {
      return;
    }

    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }, [supabase]);

  const request = useCallback(
    async <T,>(path: string, options?: RequestOptions): Promise<T> => {
      const trimmedApiKey = apiKey.trim();
      let accessToken = session?.access_token ?? null;
      if (!accessToken && supabase) {
        const { data } = await supabase.auth.getSession();
        accessToken = data.session?.access_token ?? null;
        if (data.session) {
          setSession(data.session);
        }
      }

      const buildHeaders = (token: string | null): Record<string, string> => {
        const headers: Record<string, string> = {
          Accept: "application/json",
          "x-user-id": "dashboard-shell",
          "x-role": role
        };
        if (selectedOrgId) {
          headers["x-org-id"] = selectedOrgId;
        }
        if (trimmedApiKey) {
          headers["x-api-key"] = trimmedApiKey;
        }
        if (token) {
          headers.Authorization = `Bearer ${token}`;
        }
        if (options?.body !== undefined) {
          headers["Content-Type"] = "application/json";
        }
        return headers;
      };

      const executeFetch = async (token: string | null) =>
        fetch(path, {
          method: options?.method ?? "GET",
          headers: buildHeaders(token),
          body: options?.body === undefined ? undefined : JSON.stringify(options.body)
        });

      let response = await executeFetch(accessToken);
      if (response.status === 401 && supabase && !trimmedApiKey) {
        const { data } = await supabase.auth.getSession();
        const refreshedToken = data.session?.access_token ?? null;
        if (refreshedToken && refreshedToken !== accessToken) {
          accessToken = refreshedToken;
          setSession(data.session);
          response = await executeFetch(refreshedToken);
        }
      }

      const payload = (await response.json().catch(() => null)) as { error?: string } | T | null;

      if (!response.ok) {
        const message =
          payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
            ? payload.error
            : `${response.status} ${response.statusText}`;
        throw new Error(message);
      }

      return payload as T;
    },
    [apiKey, role, selectedOrgId, session?.access_token, supabase]
  );

  const buildAuthHeaders = useCallback(
    (options?: { includeContentType?: boolean }): Record<string, string> => {
      const headers: Record<string, string> = {
        Accept: "application/json",
        "x-user-id": "dashboard-shell",
        "x-role": role
      };

      if (selectedOrgId) {
        headers["x-org-id"] = selectedOrgId;
      }
      if (apiKey.trim()) {
        headers["x-api-key"] = apiKey.trim();
      }
      if (session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`;
      }
      if (options?.includeContentType) {
        headers["Content-Type"] = "application/json";
      }
      return headers;
    },
    [apiKey, role, selectedOrgId, session?.access_token]
  );

  const reloadOrganizations = useCallback(async () => {
    setIsBusy(true);
    try {
      const payload = await request<{ organizations: Organization[] }>("/api/v1/orgs");
      setOrganizations(payload.organizations);
      if (!payload.organizations.length) {
        setSelectedOrgId("");
        return;
      }
      if (!selectedOrgId || !payload.organizations.some((org) => org.id === selectedOrgId)) {
        setSelectedOrgId(payload.organizations[0].id);
      }
    } finally {
      setIsBusy(false);
    }
  }, [request, selectedOrgId]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }
    if (supabaseEnabled && !session?.access_token && !apiKey.trim()) {
      setOrganizations([]);
      setSelectedOrgId("");
      return;
    }

    void reloadOrganizations().catch(() => {
      // Surface errors on page-level actions to avoid noisy shell-level toast logic.
    });
  }, [apiKey, isHydrated, reloadOrganizations, session?.access_token, supabaseEnabled]);

  const signIn = useCallback(
    async (email: string, password: string): Promise<void> => {
      if (!supabase) {
        throw new Error("Supabase browser credentials are not configured");
      }

      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        throw error;
      }

      setSession(data.session);
      await reloadOrganizations();
    },
    [reloadOrganizations, supabase]
  );

  const signOut = useCallback(async (): Promise<void> => {
    if (supabase) {
      await supabase.auth.signOut();
    }
    setSession(null);
  }, [supabase]);

  const value = useMemo<DashboardContextValue>(
    () => ({
      supabaseEnabled,
      session,
      organizations,
      selectedOrgId,
      role,
      apiKey,
      isHydrated,
      isBusy,
      signIn,
      signOut,
      setSelectedOrgId,
      setRole,
      setApiKey,
      buildAuthHeaders,
      request,
      reloadOrganizations
    }),
    [
      apiKey,
      isBusy,
      isHydrated,
      organizations,
      reloadOrganizations,
      buildAuthHeaders,
      request,
      role,
      selectedOrgId,
      session,
      signIn,
      signOut,
      supabaseEnabled
    ]
  );

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}

export function useDashboardContext(): DashboardContextValue {
  const value = useContext(DashboardContext);
  if (!value) {
    throw new Error("useDashboardContext must be used within DashboardProvider");
  }
  return value;
}
