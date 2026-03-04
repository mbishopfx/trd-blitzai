import { describe, expect, it } from "vitest";
import {
  addAttributionRecord,
  createBlitzRun,
  createClient,
  createOrganization,
  getAttributionWindow,
  getRun,
  listClientRuns,
  listRunActions,
  rollbackAction,
  setRunStatus
} from "../lib/control-plane-store";

describe("control-plane store", () => {
  it("creates org/client/run and seeds actions", async () => {
    const org = await createOrganization({
      name: "Test Org",
      slug: `test-org-${Date.now()}`,
      ownerEmail: "owner@test.com"
    });

    const client = await createClient({
      organizationId: org.id,
      name: "Client A",
      timezone: "America/Chicago"
    });

    const run = await createBlitzRun({
      organizationId: org.id,
      clientId: client.id,
      createdBy: "tester",
      policySnapshot: { revision: 1 }
    });

    expect((await getRun(run.id))?.status).toBe("created");
    expect((await listRunActions(run.id)).length).toBe(7);
  });

  it("supports status transitions and rollback", async () => {
    const org = await createOrganization({
      name: "Rollbacks Org",
      slug: `rollbacks-org-${Date.now()}`,
      ownerEmail: "owner@rollbacks.com"
    });

    const client = await createClient({
      organizationId: org.id,
      name: "Client B",
      timezone: "America/Chicago"
    });

    const run = await createBlitzRun({
      organizationId: org.id,
      clientId: client.id,
      createdBy: "tester",
      policySnapshot: {}
    });

    await setRunStatus(run.id, "running");
    const actions = await listRunActions(run.id);
    const rollback = await rollbackAction(actions[0].id, "test");

    expect(rollback?.action.status).toBe("rolled_back");
  });

  it("lists client runs newest-first with limit", async () => {
    const org = await createOrganization({
      name: "Runs Org",
      slug: `runs-org-${Date.now()}`,
      ownerEmail: "owner@runs.com"
    });

    const client = await createClient({
      organizationId: org.id,
      name: "Client Runs",
      timezone: "America/Chicago"
    });

    const first = await createBlitzRun({
      organizationId: org.id,
      clientId: client.id,
      createdBy: "tester",
      policySnapshot: { sequence: 1 }
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await createBlitzRun({
      organizationId: org.id,
      clientId: client.id,
      createdBy: "tester",
      policySnapshot: { sequence: 2 }
    });

    const runs = await listClientRuns(client.id, { limit: 1 });
    expect(runs).toHaveLength(1);
    expect(runs[0].id).toBe(second.id);
    expect(runs[0].id).not.toBe(first.id);
  });

  it("returns attribution summary for selected window", async () => {
    const organizationId = "org-for-attribution";
    const clientId = `client-${Date.now()}`;

    await addAttributionRecord({
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

    const report = await getAttributionWindow(clientId, "7d");
    expect(report.daily.length).toBeGreaterThan(0);
    expect(report.summary.currentConversions).toBeGreaterThan(0);
  });
});
