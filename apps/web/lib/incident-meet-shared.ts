export type IncidentSeverity = "code_red" | "code_yellow" | "code_green";

export const INCIDENT_MEET_SENDER_EMAIL = "info@truerankdigital.com";

export const INCIDENT_MEET_ATTENDEES = [
  "jose@truerankdigital.com",
  "jon@truerankdigital.com",
  "eric@truerankdigital.com",
  "jesse@truerankdigital.com"
] as const;

const simpleEmailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

export function normalizeIncidentMeetEmails(emails: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of emails) {
    const email = value.trim().toLowerCase();
    if (!email || seen.has(email) || !simpleEmailPattern.test(email)) {
      continue;
    }
    seen.add(email);
    normalized.push(email);
  }

  return normalized;
}
