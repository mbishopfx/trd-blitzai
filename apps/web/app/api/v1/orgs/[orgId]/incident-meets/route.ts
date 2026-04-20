import { NextRequest } from "next/server";
import { getRequestContext, hasRole } from "@/lib/auth";
import {
  createIncidentMeetEvent,
  getIncidentMeetConnection,
  listIncidentMeetEvents,
  upsertIncidentMeetConnection
} from "@/lib/control-plane-store";
import {
  buildIncidentMeetingPayload,
  createGoogleMeetEvent,
  INCIDENT_MEET_ATTENDEES,
  INCIDENT_MEET_SENDER_EMAIL,
  refreshIncidentMeetAccessToken,
  type IncidentSeverity
} from "@/lib/incident-meet";
import { fail, ok } from "@/lib/http";
import { isSupabaseConfigured } from "@/lib/supabase";

interface Params {
  params: { orgId: string };
}

const severityValues = new Set<IncidentSeverity>(["code_red", "code_yellow", "code_green"]);

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

  const [connection, events] = await Promise.all([
    getIncidentMeetConnection(params.orgId),
    listIncidentMeetEvents(params.orgId, 12)
  ]);

  return ok({
    connection,
    events,
    senderEmail: INCIDENT_MEET_SENDER_EMAIL,
    attendees: [...INCIDENT_MEET_ATTENDEES]
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

  const connection = await getIncidentMeetConnection(params.orgId);
  if (!connection) {
    return fail(`Connect ${INCIDENT_MEET_SENDER_EMAIL} first before launching incident meetings.`, 409);
  }
  if (connection.senderEmail.toLowerCase() !== INCIDENT_MEET_SENDER_EMAIL) {
    return fail(`Incident sender must be ${INCIDENT_MEET_SENDER_EMAIL}. Reconnect the correct Google account.`, 409);
  }

  const refreshed = await refreshIncidentMeetAccessToken(connection);
  await upsertIncidentMeetConnection({
    organizationId: connection.organizationId,
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
    attendees: [...INCIDENT_MEET_ATTENDEES]
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
    attendees: [...INCIDENT_MEET_ATTENDEES],
    createdBy: ctx.userId
  });

  return ok({
    event,
    senderEmail: connection.senderEmail
  }, 201);
}
