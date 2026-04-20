import { NextRequest } from "next/server";
import { getRequestContext, hasRole } from "@/lib/auth";
import {
  createIncidentMeetEvent,
  getIncidentMeetConnection,
  getIncidentMeetSettings,
  listIncidentMeetEvents,
  listOrganizationUserEmails,
  upsertIncidentMeetSettings,
  upsertIncidentMeetConnection
} from "@/lib/control-plane-store";
import {
  buildIncidentMeetingPayload,
  createGoogleMeetEvent,
  INCIDENT_MEET_ATTENDEES,
  normalizeIncidentMeetEmails,
  refreshIncidentMeetAccessToken,
  type IncidentSeverity
} from "@/lib/incident-meet";
import { fail, ok } from "@/lib/http";
import { isSupabaseConfigured } from "@/lib/supabase";

interface Params {
  params: { orgId: string };
}

const severityValues = new Set<IncidentSeverity>(["code_red", "code_yellow", "code_green"]);

function resolveRecipients(input: {
  availableUsers: Array<{ email: string }>;
  selectedUserEmails: string[];
  externalEmails: string[];
}) {
  const available = new Set(input.availableUsers.map((user) => user.email.toLowerCase()));
  const selectedUserEmails = normalizeIncidentMeetEmails(input.selectedUserEmails).filter((email) => available.has(email));
  const externalEmails = normalizeIncidentMeetEmails(input.externalEmails).filter((email) => !available.has(email));

  return {
    selectedUserEmails,
    externalEmails,
    attendees: normalizeIncidentMeetEmails([...selectedUserEmails, ...externalEmails])
  };
}

export async function GET(request: NextRequest, { params }: Params) {
  const ctx = await getRequestContext(request);
  if (isSupabaseConfigured()) {
    if (!ctx.isAuthenticated) {
      return fail("Unauthorized", 401);
    }
    if (ctx.organizationId !== params.orgId) {
      return fail("Forbidden", 403);
    }
    if (!hasRole(ctx, "analyst")) {
      return fail("Forbidden", 403);
    }
  }

  const [connection, events, settings, availableUsers] = await Promise.all([
    getIncidentMeetConnection(params.orgId, ctx.userId),
    listIncidentMeetEvents(params.orgId, 12),
    getIncidentMeetSettings(params.orgId),
    listOrganizationUserEmails(params.orgId)
  ]);

  const fallbackSelected = normalizeIncidentMeetEmails(
    INCIDENT_MEET_ATTENDEES.filter((email) => availableUsers.some((user) => user.email === email))
  );
  const recipients = resolveRecipients({
    availableUsers,
    selectedUserEmails: settings?.selectedUserEmails ?? fallbackSelected,
    externalEmails: settings?.externalEmails ?? []
  });

  return ok({
    connection,
    events,
    senderEmail: connection?.senderEmail ?? null,
    attendees: recipients.attendees,
    recipients: {
      availableUsers,
      selectedUserEmails: recipients.selectedUserEmails,
      externalEmails: recipients.externalEmails
    }
  });
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const ctx = await getRequestContext(request);
  if (isSupabaseConfigured()) {
    if (!ctx.isAuthenticated) {
      return fail("Unauthorized", 401);
    }
    if (ctx.organizationId !== params.orgId) {
      return fail("Forbidden", 403);
    }
    if (!hasRole(ctx, "operator")) {
      return fail("Forbidden", 403);
    }
  }

  const body = await request.json().catch(() => null);
  const availableUsers = await listOrganizationUserEmails(params.orgId);
  const recipients = resolveRecipients({
    availableUsers,
    selectedUserEmails: Array.isArray(body?.selectedUserEmails) ? body.selectedUserEmails.map(String) : [],
    externalEmails: Array.isArray(body?.externalEmails) ? body.externalEmails.map(String) : []
  });
  if (!recipients.attendees.length) {
    return fail("Select at least one internal user or add one external email.", 400);
  }

  const settings = await upsertIncidentMeetSettings({
    organizationId: params.orgId,
    selectedUserEmails: recipients.selectedUserEmails,
    externalEmails: recipients.externalEmails
  });

  return ok({
    settings,
    attendees: recipients.attendees,
    recipients: {
      availableUsers,
      selectedUserEmails: settings.selectedUserEmails,
      externalEmails: settings.externalEmails
    }
  });
}

export async function POST(request: NextRequest, { params }: Params) {
  const ctx = await getRequestContext(request);
  if (isSupabaseConfigured()) {
    if (!ctx.isAuthenticated) {
      return fail("Unauthorized", 401);
    }
    if (ctx.organizationId !== params.orgId) {
      return fail("Forbidden", 403);
    }
    if (!hasRole(ctx, "operator")) {
      return fail("Forbidden", 403);
    }
  }

  const body = await request.json().catch(() => null);
  const severity = typeof body?.severity === "string" && severityValues.has(body.severity as IncidentSeverity)
    ? (body.severity as IncidentSeverity)
    : null;
  if (!severity) {
    return fail("severity must be one of code_red, code_yellow, or code_green", 400);
  }

  const connection = await getIncidentMeetConnection(params.orgId, ctx.userId);
  if (!connection) {
    return fail("Connect Google before launching an incident meeting.", 409);
  }

  const [settings, availableUsers] = await Promise.all([
    getIncidentMeetSettings(params.orgId),
    listOrganizationUserEmails(params.orgId)
  ]);
  const fallbackSelected = normalizeIncidentMeetEmails(
    INCIDENT_MEET_ATTENDEES.filter((email) => availableUsers.some((user) => user.email === email))
  );
  const recipients = resolveRecipients({
    availableUsers,
    selectedUserEmails: settings?.selectedUserEmails ?? fallbackSelected,
    externalEmails: settings?.externalEmails ?? []
  });
  if (!recipients.attendees.length) {
    return fail("Configure at least one incident recipient before launching a meeting.", 409);
  }

  const refreshed = await refreshIncidentMeetAccessToken(connection);
  await upsertIncidentMeetConnection({
    organizationId: connection.organizationId,
    userId: connection.userId ?? ctx.userId,
    senderEmail: connection.senderEmail,
    encryptedTokenPayload: refreshed.encryptedTokenPayload,
    scopes: connection.scopes,
    metadata: connection.metadata,
    tokenExpiresAt: refreshed.expiresAt,
    lastRefreshAt: new Date().toISOString()
  });

  const incident = buildIncidentMeetingPayload(severity);
  const calendarEvent = await createGoogleMeetEvent({
    accessToken: refreshed.accessToken,
    severity,
    startsAt: incident.startsAt,
    endsAt: incident.endsAt,
    summary: incident.summary,
    description: incident.description,
    attendees: recipients.attendees
  });

  const event = await createIncidentMeetEvent({
    organizationId: params.orgId,
    connectionId: connection.id,
    severity,
    summary: incident.summary,
    description: incident.description,
    meetUrl: calendarEvent.meetUrl,
    calendarEventId: calendarEvent.eventId,
    calendarHtmlLink: calendarEvent.htmlLink,
    startsAt: incident.startsAt,
    endsAt: incident.endsAt,
    attendees: recipients.attendees,
    createdBy: ctx.userId
  });

  return ok({
    event,
    senderEmail: connection.senderEmail
  }, 201);
}
