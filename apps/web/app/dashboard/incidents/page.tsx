"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BellRing,
  Check,
  CircleAlert,
  Clock3,
  ExternalLink,
  Link2,
  Plus,
  RadioTower,
  ShieldAlert,
  Trash2
} from "lucide-react";
import { useDashboardContext } from "../_components/dashboard-context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import {
  normalizeIncidentMeetEmails,
  type IncidentSeverity
} from "@/lib/incident-meet-shared";

interface IncidentMeetConnection {
  id: string;
  userId?: string | null;
  senderEmail: string;
  connectedAt: string;
  tokenExpiresAt: string | null;
}

interface IncidentMeetEvent {
  id: string;
  severity: IncidentSeverity;
  summary: string;
  description: string;
  meetUrl: string | null;
  calendarHtmlLink: string | null;
  startsAt: string;
  endsAt: string;
  attendees: string[];
  createdAt: string;
}

interface IncidentRecipient {
  email: string;
  role: string;
}

interface IncidentRecipientsPayload {
  attendees: string[];
  recipients: {
    availableUsers: IncidentRecipient[];
    selectedUserEmails: string[];
    externalEmails: string[];
  };
}

interface IncidentMeetPayload extends IncidentRecipientsPayload {
  connection: IncidentMeetConnection | null;
  events: IncidentMeetEvent[];
  senderEmail: string | null;
}

const severityCards: Array<{
  severity: IncidentSeverity;
  title: string;
  description: string;
  launchLabel: string;
  badgeLabel: string;
  className: string;
}> = [
  {
    severity: "code_red",
    title: "Code Red",
    description: "Urgent incident bridge. Starts within 5 minutes and should be treated as a priority response call.",
    launchLabel: "Launch Code Red Meet",
    badgeLabel: "Starts in 5 minutes",
    className: "border-red-200 bg-red-50/80"
  },
  {
    severity: "code_yellow",
    title: "Code Yellow",
    description: "Priority issue coordination. Gives the team a 30 minute heads up before the meeting begins.",
    launchLabel: "Launch Code Yellow Meet",
    badgeLabel: "Starts in 30 minutes",
    className: "border-amber-200 bg-amber-50/80"
  },
  {
    severity: "code_green",
    title: "Code Green",
    description: "General brainstorming session. Optional join, scheduled 15 minutes out for open discussion.",
    launchLabel: "Launch Code Green Meet",
    badgeLabel: "Starts in 15 minutes",
    className: "border-emerald-200 bg-emerald-50/80"
  }
];

function formatDate(value: string | null): string {
  if (!value) return "N/A";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function severityLabel(value: IncidentSeverity): string {
  return value === "code_red" ? "Code Red" : value === "code_yellow" ? "Code Yellow" : "Code Green";
}

function sameEmailList(left: string[], right: string[]): boolean {
  return JSON.stringify(normalizeIncidentMeetEmails(left)) === JSON.stringify(normalizeIncidentMeetEmails(right));
}

export default function IncidentMeetsPage() {
  const { selectedOrgId, request } = useDashboardContext();
  const [payload, setPayload] = useState<IncidentMeetPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [launchingSeverity, setLaunchingSeverity] = useState<IncidentSeverity | null>(null);
  const [savingRecipients, setSavingRecipients] = useState(false);
  const [pendingExternalEmail, setPendingExternalEmail] = useState("");
  const [selectedUserEmails, setSelectedUserEmails] = useState<string[]>([]);
  const [externalEmails, setExternalEmails] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const loadIncidentState = async () => {
    if (!selectedOrgId) {
      setPayload(null);
      setSelectedUserEmails([]);
      setExternalEmails([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await request<IncidentMeetPayload>(`/api/v1/orgs/${selectedOrgId}/incident-meets`);
      setPayload(response);
      setSelectedUserEmails(response.recipients.selectedUserEmails);
      setExternalEmails(response.recipients.externalEmails);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadIncidentState();
  }, [selectedOrgId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get("incident_meet_connected") === "true") {
      setStatus("Google Calendar connected for your account.");
    }
    if (params.get("incident_meet_error")) {
      setError(params.get("incident_meet_error"));
    }
  }, []);

  const senderConnected = Boolean(payload?.connection?.senderEmail);
  const availableUsers = payload?.recipients.availableUsers ?? [];
  const resolvedAttendees = normalizeIncidentMeetEmails([...selectedUserEmails, ...externalEmails]);
  const recipientsDirty =
    !sameEmailList(selectedUserEmails, payload?.recipients.selectedUserEmails ?? []) ||
    !sameEmailList(externalEmails, payload?.recipients.externalEmails ?? []);

  const launchIncident = async (severity: IncidentSeverity) => {
    if (!selectedOrgId) {
      setError("Select an organization before launching an incident meeting.");
      return;
    }

    setLaunchingSeverity(severity);
    setError(null);
    setStatus(null);

    try {
      const response = await request<{ event: IncidentMeetEvent }>(`/api/v1/orgs/${selectedOrgId}/incident-meets`, {
        method: "POST",
        body: { severity }
      });

      setStatus(`${severityLabel(severity)} invite sent. Meet link: ${response.event.meetUrl ?? "calendar event created"}`);
      await loadIncidentState();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setLaunchingSeverity(null);
    }
  };

  const connectSender = async () => {
    if (!selectedOrgId) {
      setError("Select an organization before connecting the sender account.");
      return;
    }

    setConnecting(true);
    setError(null);

    try {
      const response = await request<{ authUrl: string }>(
        `/api/v1/orgs/${selectedOrgId}/incident-meets/google/start?returnPath=${encodeURIComponent("/dashboard/incidents")}`
      );
      window.location.assign(response.authUrl);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
      setConnecting(false);
    }
  };

  const saveRecipients = async () => {
    if (!selectedOrgId) {
      setError("Select an organization before editing recipients.");
      return;
    }

    setSavingRecipients(true);
    setError(null);
    setStatus(null);

    try {
      const response = await request<IncidentRecipientsPayload>(`/api/v1/orgs/${selectedOrgId}/incident-meets`, {
        method: "PATCH",
        body: {
          selectedUserEmails,
          externalEmails
        }
      });
      setSelectedUserEmails(response.recipients.selectedUserEmails);
      setExternalEmails(response.recipients.externalEmails);
      setPayload((current) =>
        current
          ? {
              ...current,
              attendees: response.attendees,
              recipients: response.recipients
            }
          : null
      );
      setPendingExternalEmail("");
      setStatus("Incident recipients updated.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setSavingRecipients(false);
    }
  };

  const toggleInternalRecipient = (email: string) => {
    setSelectedUserEmails((current) =>
      current.includes(email) ? current.filter((value) => value !== email) : [...current, email]
    );
  };

  const addExternalEmail = () => {
    const next = normalizeIncidentMeetEmails([...externalEmails, pendingExternalEmail]);
    if (next.length === externalEmails.length) {
      return;
    }
    setExternalEmails(next);
    setPendingExternalEmail("");
  };

  const removeExternalEmail = (email: string) => {
    setExternalEmails((current) => current.filter((value) => value !== email));
  };

  const eventStats = useMemo(
    () => ({
      recent: payload?.events.length ?? 0,
      next: payload?.events[0]?.startsAt ?? null
    }),
    [payload]
  );

  return (
    <div className="flex flex-col gap-6">
      <Card className="border-border/80 bg-card/95 shadow-sm">
        <CardHeader>
          <CardTitle>Incident Meet Launch</CardTitle>
          <CardDescription>
            One-touch Google Meet launches for urgent response, priority coordination, and optional brainstorming. These
            invites go out from the Google account connected by the logged-in user.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={senderConnected ? "secondary" : "outline"}>
              {senderConnected ? "Sender connected" : "Sender not connected"}
            </Badge>
            <Badge variant="outline">Recipients: {resolvedAttendees.length}</Badge>
            <Badge variant="outline">Recent meetings: {eventStats.recent}</Badge>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void connectSender()} disabled={connecting}>
              <Link2 data-icon="inline-start" />
              {connecting ? "Connecting Google..." : senderConnected ? "Reconnect Google" : "Connect to Google"}
            </Button>
            <Button variant="ghost" onClick={() => void loadIncidentState()} disabled={loading}>
              Refresh status
            </Button>
          </div>
        </CardContent>
      </Card>

      {status ? (
        <Alert>
          <BellRing />
          <AlertTitle>Incident update</AlertTitle>
          <AlertDescription>{status}</AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Incident launch issue</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Sender Account</CardDescription>
            <CardTitle>{payload?.connection?.senderEmail ?? "Not connected"}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Connected at: {formatDate(payload?.connection?.connectedAt ?? null)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Invite Roster</CardDescription>
            <CardTitle>{resolvedAttendees.length}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Select TRD team members and add outside emails when a meeting needs extra participants.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Next Scheduled</CardDescription>
            <CardTitle>{eventStats.next ? formatDate(eventStats.next) : "None"}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              The newest incident launch appears here after a Meet event is created.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Recipient Controls</CardTitle>
          <CardDescription>
            Choose which internal users get incident invites and add any external email addresses for this organization.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-4">
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-medium">Internal Users</h3>
                <p className="text-sm text-muted-foreground">These addresses come from the current organization membership.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {availableUsers.map((user) => {
                  const checked = selectedUserEmails.includes(user.email);
                  return (
                    <label
                      key={user.email}
                      className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/80 bg-card px-4 py-3"
                    >
                      <input
                        checked={checked}
                        className="mt-1 size-4"
                        onChange={() => toggleInternalRecipient(user.email)}
                        type="checkbox"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-medium">{user.email}</p>
                          {checked ? <Check className="size-4 text-emerald-600" /> : null}
                        </div>
                        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{user.role}</p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-3 rounded-xl border border-border/80 bg-muted/30 p-4">
              <div>
                <Label htmlFor="incident-external-email">External Email</Label>
                <p className="text-sm text-muted-foreground">Add anyone outside the org who should receive the invite.</p>
              </div>
              <div className="flex gap-2">
                <Input
                  id="incident-external-email"
                  onChange={(event) => setPendingExternalEmail(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addExternalEmail();
                    }
                  }}
                  placeholder="partner@example.com"
                  value={pendingExternalEmail}
                />
                <Button onClick={addExternalEmail} type="button" variant="secondary">
                  <Plus data-icon="inline-start" />
                  Add
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {externalEmails.length ? (
                  externalEmails.map((email) => (
                    <Badge className="gap-2" key={email} variant="outline">
                      {email}
                      <button
                        aria-label={`Remove ${email}`}
                        className="inline-flex"
                        onClick={() => removeExternalEmail(email)}
                        type="button"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </Badge>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No external emails added yet.</p>
                )}
              </div>
            </div>

            <div className="space-y-3 rounded-xl border border-border/80 p-4">
              <div>
                <h3 className="text-sm font-medium">Final Invite List</h3>
                <p className="text-sm text-muted-foreground">This roster will receive the next incident launch.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {resolvedAttendees.length ? (
                  resolvedAttendees.map((email) => (
                    <Badge key={email} variant="secondary">{email}</Badge>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">Select at least one user or add an external email.</p>
                )}
              </div>
              <Button disabled={!recipientsDirty || savingRecipients} onClick={() => void saveRecipients()}>
                {savingRecipients ? "Saving recipients..." : "Save recipient settings"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {severityCards.map((card) => (
          <Card key={card.severity} className={card.className}>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>{card.title}</CardTitle>
                  <CardDescription className="text-foreground/80">{card.description}</CardDescription>
                </div>
                <Badge variant="outline">{card.badgeLabel}</Badge>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-start gap-2 text-sm text-muted-foreground">
                {card.severity === "code_red" ? (
                  <ShieldAlert className="mt-0.5 text-red-600" />
                ) : card.severity === "code_yellow" ? (
                  <Clock3 className="mt-0.5 text-amber-600" />
                ) : (
                  <RadioTower className="mt-0.5 text-emerald-600" />
                )}
                <span>
                  {card.severity === "code_red"
                    ? "Use this when an incident needs immediate team attention."
                    : card.severity === "code_yellow"
                      ? "Use this when the team needs time to gather context before joining."
                      : "Use this for brainstorming, debriefs, or optional planning sessions."}
                </span>
              </div>
              <Button
                className="w-full"
                disabled={!senderConnected || launchingSeverity !== null || resolvedAttendees.length === 0 || recipientsDirty}
                onClick={() => void launchIncident(card.severity)}
              >
                <BellRing data-icon="inline-start" />
                {launchingSeverity === card.severity ? "Launching..." : card.launchLabel}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Recent Incident Meetings</CardTitle>
          <CardDescription>Every generated Meet session is logged here with the final call link.</CardDescription>
        </CardHeader>
        <CardContent>
          {payload?.events.length ? (
            <div className="overflow-hidden rounded-xl border border-border/80">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Severity</TableHead>
                    <TableHead>Summary</TableHead>
                    <TableHead>Starts</TableHead>
                    <TableHead>Attendees</TableHead>
                    <TableHead>Meet</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payload.events.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell>
                        <Badge variant="outline">{severityLabel(event.severity)}</Badge>
                      </TableCell>
                      <TableCell className="max-w-[340px]">
                        <div className="space-y-1">
                          <p className="font-medium">{event.summary}</p>
                          <p className="text-xs text-muted-foreground">{event.description}</p>
                        </div>
                      </TableCell>
                      <TableCell>{formatDate(event.startsAt)}</TableCell>
                      <TableCell>{event.attendees.join(", ")}</TableCell>
                      <TableCell>
                        {event.meetUrl ? (
                          <Button render={<a href={event.meetUrl} target="_blank" rel="noreferrer" />} variant="ghost" size="sm">
                            <ExternalLink data-icon="inline-start" />
                            Open Meet
                          </Button>
                        ) : event.calendarHtmlLink ? (
                          <Button render={<a href={event.calendarHtmlLink} target="_blank" rel="noreferrer" />} variant="ghost" size="sm">
                            <ExternalLink data-icon="inline-start" />
                            Open Event
                          </Button>
                        ) : (
                          "N/A"
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <Empty className="border border-dashed border-border/80">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <BellRing />
                </EmptyMedia>
                <EmptyTitle>No incident meetings yet</EmptyTitle>
                <EmptyDescription>
                  Connect the sender account, save a recipient list, then use one of the launch buttons to create the first Google Meet bridge.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
