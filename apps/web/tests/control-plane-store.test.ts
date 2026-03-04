import { describe, expect, it } from "vitest";
import {
  addAttributionRecord,
  createBlitzRun,
  createClient,
  createOrganization,
  getAttributionWindow,
  getRun,
  listRunActions,
  rollbackAction,
  setRunStatus
} from "../lib/control-plane-store";

describe("control-plane store", () => {
  it("creates org/client/run and seeds actions", () => {
    const org = createOrganization({
      name: "Test Org",
      slug: `test-org-${Date.now()}`,
      ownerEmail: "owner@test.com"
    });

    const client = createClient({
      organizationId: org.id,
      name: "Client A",
      timezone: "America/Chicago"
    });

    const run = createBlitzRun({
      organizationId: org.id,
      clientId: client.id,
      createdBy: "tester",
      policySnapshot: { revision: 1 }
    });

    expect(getRun(run.id)?.status).toBe("created");
    expect(listRunActions(run.id).length).toBe(7);
  });

  it("supports status transitions and rollback", () => {
    const org = createOrganization({
      name: "Rollbacks Org",
      slug: `rollbacks-org-${Date.now()}`,
      ownerEmail: "owner@rollbacks.com"
    });

    const client = createClient({
      organizationId: org.id,
      name: "Client B",
      timezone: "America/Chicago"
    });

    const run = createBlitzRun({
      organizationId: org.id,
      clientId: client.id,
      createdBy: "tester",
      policySnapshot: {}
    });

    setRunStatus(run.id, "running");
    const actions = listRunActions(run.id);
    const rollback = rollbackAction(actions[0].id, "test");

    expect(rollback?.action.status).toBe("rolled_back");
  });

  it("returns attribution summary for selected window", () => {
    const organizationId = "org-for-attribution";
    const clientId = `client-${Date.now()}`;

    addAttributionRecord({
      organizationId,
      clientId,
      locationId: "loc-1",
      date: new Date().toISOString().slice(0, 10),
      channel: "google_ads",
      impressions: 100,
      clicks: 20,
      calls: 0,
      directions: 0,
      conversions: 5,
      spend: 50,
      conversionValue: 250,
      sourcePayload: {}
    });

    const report = getAttributionWindow(clientId, "7d");
    expect(report.daily.length).toBeGreaterThan(0);
    expect(report.summary.currentConversions).toBeGreaterThan(0);
  });
});
