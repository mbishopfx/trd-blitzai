import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { z } from "zod";
import { getRequestContext, hasRole } from "@/lib/auth";
import { getClientById, getClientOrchestrationSettings } from "@/lib/control-plane-store";
import { fail, ok } from "@/lib/http";
import { getSupabaseServiceClient, isSupabaseConfigured } from "@/lib/supabase";

interface Params {
  params: { clientId: string };
}

const payloadSchema = z.object({
  source: z.string().min(2).max(80).default("crm"),
  eventType: z.string().min(2).max(120).default("job_completed_paid"),
  eventId: z.string().min(2).max(120).optional(),
  crmJobId: z.string().min(2).max(120).optional(),
  completedAt: z.string().datetime().optional(),
  customerFirstName: z.string().min(1).max(120),
  customerPhone: z.string().min(6).max(40).optional(),
  customerEmail: z.string().email().optional(),
  technicianName: z.string().min(1).max(120).optional(),
  servicePerformed: z.string().min(1).max(180).optional(),
  city: z.string().min(1).max(120).optional(),
  reviewUrl: z.string().url().optional(),
  channels: z.array(z.enum(["sms", "email"])).min(1).max(2).optional(),
  metadata: z.record(z.unknown()).optional()
});

function nowIso(): string {
  return new Date().toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function normalizeHttpUrl(value: string | null | undefined): string | null {
  if (!value || !value.trim()) {
    return null;
  }
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function toNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizePhone(value: string): string {
  return value.replace(/[^0-9+]/g, "").trim();
}

function uniqueChannels(input: Array<"sms" | "email">): Array<"sms" | "email"> {
  return [...new Set(input)] as Array<"sms" | "email">;
}

function buildSmsMessage(input: {
  businessName: string;
  customerFirstName: string;
  technicianName?: string;
  servicePerformed?: string;
  city?: string;
  reviewUrl: string;
}): string {
  const service = input.servicePerformed?.trim() || "your service";
  const tech = input.technicianName?.trim() ? ` with ${input.technicianName.trim()}` : "";
  const city = input.city?.trim() ? ` in ${input.city.trim()}` : "";
  const draft = `Hi ${input.customerFirstName}, thanks for trusting ${input.businessName}${tech} for ${service}${city}. If we earned it, please leave a quick review: ${input.reviewUrl}`;
  return draft.slice(0, 500);
}

function buildEmailBody(input: {
  businessName: string;
  customerFirstName: string;
  technicianName?: string;
  servicePerformed?: string;
  city?: string;
  reviewUrl: string;
}): string {
  const service = input.servicePerformed?.trim() || "your recent service";
  const tech = input.technicianName?.trim() || "our team";
  const city = input.city?.trim() ? ` in ${input.city.trim()}` : "";

  return [
    `Hi ${input.customerFirstName},`,
    "",
    `Thank you for trusting ${tech} at ${input.businessName} for ${service}${city}.`,
    "",
    "If we earned it, could you leave a quick Google review?",
    input.reviewUrl,
    "",
    "Your feedback helps local customers make informed decisions and helps us improve delivery quality.",
    "",
    `- ${input.businessName}`
  ].join("\n");
}

export async function POST(request: NextRequest, { params }: Params) {
  if (!isSupabaseConfigured()) {
    return fail("Supabase service credentials are required for review ignition webhooks", 503);
  }

  const ctx = await getRequestContext(request);
  const hasSessionAccess = ctx.isAuthenticated && hasRole(ctx, "operator");
  if (!hasSessionAccess) {
    const expectedSecret = process.env.BLITZ_REVIEW_WEBHOOK_SECRET?.trim();
    const providedSecret = request.headers.get("x-blitz-webhook-secret")?.trim();
    if (!expectedSecret) {
      return fail("Webhook secret not configured on server", 503);
    }
    if (!providedSecret || providedSecret !== expectedSecret) {
      return fail("Unauthorized", 401);
    }
  }

  const client = await getClientById(params.clientId);
  if (!client) {
    return fail("Client not found", 404);
  }
  if (hasSessionAccess && client.organizationId !== ctx.organizationId) {
    return fail("Forbidden", 403);
  }

  const body = await request.json().catch(() => null);
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid review ignition payload", 400, parsed.error.flatten());
  }

  const settings = await getClientOrchestrationSettings(client.id);
  const settingsMetadata = asRecord(settings.metadata);
  const supabase = getSupabaseServiceClient();
  const acceptedAt = nowIso();

  const reviewUrl =
    normalizeHttpUrl(parsed.data.reviewUrl) ??
    normalizeHttpUrl(typeof settingsMetadata.reviewRequestUrl === "string" ? settingsMetadata.reviewRequestUrl : null);
  if (!reviewUrl) {
    return fail("Missing reviewUrl. Provide reviewUrl in payload or client settings metadata.reviewRequestUrl", 400);
  }

  const configuredChannels = Array.isArray(parsed.data.channels)
    ? parsed.data.channels
    : [parsed.data.customerPhone ? "sms" : null, parsed.data.customerEmail ? "email" : null].filter(
        (value): value is "sms" | "email" => value === "sms" || value === "email"
      );
  const channels = uniqueChannels(configuredChannels);
  if (!channels.length) {
    return fail("No valid dispatch channels. Provide customerPhone and/or customerEmail", 400);
  }

  const dailyCap = clamp(Math.round(toNumber(settingsMetadata.reviewRequestDailyCap, 24)), 1, 400);
  const cooldownMinutes = clamp(Math.round(toNumber(settingsMetadata.reviewRequestCooldownMinutes, 30)), 5, 720);
  const delayMinutes = clamp(Math.round(toNumber(settingsMetadata.reviewRequestDelayMinutes, 10)), 0, 720);
  const jitterMaxMinutes = clamp(Math.round(toNumber(settingsMetadata.reviewRequestJitterMaxMinutes, 30)), 0, 240);

  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const { count: todayCount, error: countError } = await supabase
    .from("content_artifacts")
    .select("id", { count: "exact", head: true })
    .eq("client_id", client.id)
    .eq("phase", "reviews")
    .in("channel", ["review_request_sms", "review_request_email"])
    .gte("created_at", dayStart.toISOString());
  if (countError) {
    return fail(`Failed to evaluate review request pacing: ${countError.message}`, 500);
  }

  const existingToday = todayCount ?? 0;
  if (existingToday >= dailyCap) {
    return fail(`Daily review request cap reached (${dailyCap}).`, 429, {
      dailyCap,
      existingToday
    });
  }

  const artifactRows: Array<Record<string, unknown>> = [];
  const duplicateFingerprints: string[] = [];

  const baseEventId = parsed.data.eventId ?? parsed.data.crmJobId ?? `${parsed.data.source}:${acceptedAt}`;
  const remainingCapacity = Math.max(0, dailyCap - existingToday);
  let slotsUsed = 0;

  for (const channel of channels) {
    if (slotsUsed >= remainingCapacity) {
      break;
    }

    const normalizedPhone = parsed.data.customerPhone ? normalizePhone(parsed.data.customerPhone) : "";
    const recipient = channel === "sms" ? normalizedPhone : parsed.data.customerEmail?.trim() ?? "";
    if (!recipient) {
      continue;
    }

    const fingerprintBase = `${client.id}:${baseEventId}:${channel}:${recipient}`;
    const requestFingerprint = createHash("sha256").update(fingerprintBase).digest("hex");

    const { data: duplicateRows, error: duplicateError } = await supabase
      .from("content_artifacts")
      .select("id")
      .eq("client_id", client.id)
      .eq("phase", "reviews")
      .contains("metadata", { requestFingerprint })
      .limit(1);
    if (duplicateError) {
      return fail(`Failed to evaluate duplicate review request events: ${duplicateError.message}`, 500);
    }
    if (Array.isArray(duplicateRows) && duplicateRows.length > 0) {
      duplicateFingerprints.push(requestFingerprint);
      continue;
    }

    const slotIndex = existingToday + slotsUsed;
    const jitterSeed = parseInt(requestFingerprint.slice(0, 8), 16);
    const jitterMinutes = jitterMaxMinutes > 0 ? jitterSeed % (jitterMaxMinutes + 1) : 0;
    const totalMinutes = delayMinutes + slotIndex * cooldownMinutes + jitterMinutes;
    const scheduledFor = new Date(Date.now() + totalMinutes * 60_000).toISOString();

    const messageInput = {
      businessName: client.name,
      customerFirstName: parsed.data.customerFirstName,
      technicianName: parsed.data.technicianName,
      servicePerformed: parsed.data.servicePerformed,
      city: parsed.data.city,
      reviewUrl
    };
    const messageBody = buildSmsMessage(messageInput);
    const emailSubject = `${client.name}: quick feedback request`;
    const emailBody = buildEmailBody(messageInput);

    const metadata: Record<string, unknown> = {
      source: parsed.data.source,
      eventType: parsed.data.eventType,
      eventId: baseEventId,
      requestFingerprint,
      customerFirstName: parsed.data.customerFirstName,
      customerPhone: normalizedPhone || null,
      customerEmail: parsed.data.customerEmail ?? null,
      technicianName: parsed.data.technicianName ?? null,
      servicePerformed: parsed.data.servicePerformed ?? null,
      city: parsed.data.city ?? null,
      reviewUrl,
      acceptedAt,
      dispatchActionType: "review_reply",
      dispatchRiskTier: "low",
      actionPayload:
        channel === "sms"
          ? {
              objective: "review_request_dispatch",
              channel,
              toPhone: normalizedPhone,
              messageBody,
              reviewUrl
            }
          : {
              objective: "review_request_dispatch",
              channel,
              toEmail: parsed.data.customerEmail ?? "",
              emailSubject,
              emailBody,
              messageBody,
              reviewUrl
            },
      crmPayload: parsed.data.metadata ?? {}
    };

    const row = {
      organization_id: client.organizationId,
      client_id: client.id,
      run_id: null,
      phase: "reviews",
      channel: channel === "sms" ? "review_request_sms" : "review_request_email",
      title:
        channel === "sms"
          ? `Review request SMS: ${parsed.data.customerFirstName}`
          : `Review request Email: ${parsed.data.customerFirstName}`,
      body: channel === "sms" ? messageBody : emailBody,
      metadata,
      status: "scheduled",
      scheduled_for: scheduledFor,
      published_at: null
    };

    const { data: inserted, error: insertError } = await supabase
      .from("content_artifacts")
      .insert(row)
      .select("id,channel,scheduled_for,status")
      .single();
    if (insertError || !inserted) {
      return fail(`Failed to queue review request artifact: ${insertError?.message ?? "unknown error"}`, 500);
    }

    artifactRows.push({
      id: String(inserted.id),
      channel: String(inserted.channel),
      status: String(inserted.status),
      scheduledFor: typeof inserted.scheduled_for === "string" ? inserted.scheduled_for : scheduledFor,
      recipient
    });

    slotsUsed += 1;
  }

  const webhookSummary = {
    acceptedAt,
    queuedCount: artifactRows.length,
    duplicateCount: duplicateFingerprints.length,
    channels,
    source: parsed.data.source,
    eventType: parsed.data.eventType,
    eventId: baseEventId
  };

  await supabase.from("webhook_deliveries").insert({
    organization_id: client.organizationId,
    client_id: client.id,
    url: request.nextUrl.toString(),
    event_type: "crm.review_request.triggered",
    payload: {
      ...parsed.data,
      webhookSummary
    },
    response_status: 202,
    response_body: JSON.stringify(webhookSummary),
    attempt_count: 1,
    last_attempted_at: acceptedAt,
    completed_at: acceptedAt
  });

  return ok(
    {
      accepted: true,
      queued: artifactRows.length,
      duplicatesSkipped: duplicateFingerprints.length,
      dailyCap,
      artifacts: artifactRows
    },
    202
  );
}
