import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { decryptJson, encryptJson } from "./crypto";
import type { IncidentMeetConnection } from "./control-plane-store";
import { refreshGoogleAccessToken } from "./google-oauth";
import {
  INCIDENT_MEET_ATTENDEES,
  INCIDENT_MEET_SENDER_EMAIL,
  type IncidentSeverity
} from "./incident-meet-shared";

export {
  INCIDENT_MEET_ATTENDEES,
  INCIDENT_MEET_SENDER_EMAIL
} from "./incident-meet-shared";
export type { IncidentSeverity } from "./incident-meet-shared";

export interface IncidentMeetState {
  organizationId: string;
  userId: string;
  returnPath: string;
}

const GOOGLE_OAUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";
const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const GOOGLE_USERINFO_SCOPES = [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "openid"
];

const INCIDENT_MEET_CONFIG: Record<
  IncidentSeverity,
  {
    label: string;
    startsInMinutes: number;
    durationMinutes: number;
    summary: string;
    description: string;
  }
> = {
  code_red: {
    label: "Code Red",
    startsInMinutes: 5,
    durationMinutes: 30,
    summary: "CODE RED: Immediate incident response bridge",
    description:
      "Urgent production incident bridge. This meeting is created for immediate response and starts within five minutes of launch. All listed responders should treat this as a priority join."
  },
  code_yellow: {
    label: "Code Yellow",
    startsInMinutes: 30,
    durationMinutes: 30,
    summary: "CODE YELLOW: Priority issue coordination meeting",
    description:
      "Priority issue coordination meeting. This invite gives the team a 30 minute heads up before start time so people can prepare context and join ready to act."
  },
  code_green: {
    label: "Code Green",
    startsInMinutes: 15,
    durationMinutes: 45,
    summary: "CODE GREEN: Open brainstorming and optional strategy room",
    description:
      "Open brainstorming and optional strategy room. This session is meant for general discussion and idea sharing, with a 15 minute notice before it begins."
  }
};

export function encodeIncidentMeetState(state: IncidentMeetState): string {
  return Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
}

export function decodeIncidentMeetState(value: string): IncidentMeetState {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as IncidentMeetState;
}

export function buildIncidentMeetOAuthUrl(input: {
  clientId: string;
  redirectUri: string;
  state: IncidentMeetState;
}): string {
  const url = new URL(GOOGLE_OAUTH_BASE);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", [GOOGLE_CALENDAR_SCOPE, ...GOOGLE_USERINFO_SCOPES].join(" "));
  url.searchParams.set("state", encodeIncidentMeetState(input.state));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent select_account");
  return url.toString();
}

export async function fetchGoogleAccountEmail(accessToken: string): Promise<string> {
  const response = await fetch(GOOGLE_USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) {
    throw new Error(`Failed to resolve Google account profile (${response.status})`);
  }

  const payload = (await response.json()) as { email?: string };
  if (!payload.email) {
    throw new Error("Google account profile did not include an email address");
  }

  return payload.email;
}

export function buildIncidentMeetingPayload(severity: IncidentSeverity) {
  const config = INCIDENT_MEET_CONFIG[severity];
  const start = new Date(Date.now() + config.startsInMinutes * 60 * 1000);
  const end = new Date(start.getTime() + config.durationMinutes * 60 * 1000);

  return {
    severity,
    label: config.label,
    summary: config.summary,
    description: config.description,
    startsAt: start.toISOString(),
    endsAt: end.toISOString()
  };
}

export function decodeStoredGoogleToken(connection: IncidentMeetConnection): {
  accessToken: string;
  refreshToken: string;
  expiresAt: string | null;
} {
  const token = String(connection.encryptedTokenPayload.token ?? "");
  const payload = decryptJson(token);

  return {
    accessToken: String(payload.accessToken ?? ""),
    refreshToken: String(payload.refreshToken ?? ""),
    expiresAt: typeof payload.expiresAt === "string" ? payload.expiresAt : null
  };
}

export function encodeStoredGoogleToken(input: {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}): Record<string, unknown> {
  return {
    token: encryptJson({
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
      expiresAt: input.expiresAt
    })
  };
}

export async function refreshIncidentMeetAccessToken(connection: IncidentMeetConnection): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  encryptedTokenPayload: Record<string, unknown>;
}> {
  const oauthClientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const oauthClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!oauthClientId || !oauthClientSecret) {
    throw new Error("Google OAuth environment is not configured");
  }

  const stored = decodeStoredGoogleToken(connection);
  if (!stored.refreshToken) {
    throw new Error("Incident Meet sender connection is missing a refresh token");
  }

  const isFresh =
    stored.accessToken &&
    stored.expiresAt &&
    new Date(stored.expiresAt).getTime() - Date.now() > 60 * 1000;

  if (isFresh) {
    return {
      accessToken: stored.accessToken,
      refreshToken: stored.refreshToken,
      expiresAt: stored.expiresAt!,
      encryptedTokenPayload: connection.encryptedTokenPayload
    };
  }

  const refreshed = await refreshGoogleAccessToken({
    clientId: oauthClientId,
    clientSecret: oauthClientSecret,
    refreshToken: stored.refreshToken
  });

  return {
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    expiresAt: refreshed.expiresAt,
    encryptedTokenPayload: encodeStoredGoogleToken({
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      expiresAt: refreshed.expiresAt
    })
  };
}

export async function createGoogleMeetEvent(input: {
  accessToken: string;
  severity: IncidentSeverity;
  startsAt: string;
  endsAt: string;
  summary: string;
  description: string;
  attendees: string[];
}): Promise<{
  eventId: string | null;
  htmlLink: string | null;
  meetUrl: string | null;
}> {
  const response = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        summary: input.summary,
        description: input.description,
        start: { dateTime: input.startsAt },
        end: { dateTime: input.endsAt },
        attendees: input.attendees.map((email) => ({ email })),
        guestsCanInviteOthers: false,
        guestsCanModify: false,
        conferenceData: {
          createRequest: {
            requestId: `incident-${input.severity}-${randomUUID()}`,
            conferenceSolutionKey: {
              type: "hangoutsMeet"
            }
          }
        }
      })
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to create Google Meet event (${response.status}): ${body}`);
  }

  const payload = (await response.json()) as {
    id?: string;
    htmlLink?: string;
    hangoutLink?: string;
    conferenceData?: { entryPoints?: Array<{ uri?: string; entryPointType?: string }> };
  };

  const meetEntry = payload.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "video");

  return {
    eventId: payload.id ?? null,
    htmlLink: payload.htmlLink ?? null,
    meetUrl: meetEntry?.uri ?? payload.hangoutLink ?? null
  };
}
