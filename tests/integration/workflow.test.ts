/**
 * End-to-end backend workflow against real Postgres (PGlite in memory):
 * discover → analyze → merge/dedupe → validate → edit → approve → create market.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import { requeueItem, runDiscovery } from "@/server/discovery/pipeline";
import { HeuristicAnalyzer, LlmError, type Analyzer } from "@/server/llm";
import { mockCreateMarket } from "@/server/markets/mockOmx";
import { getCandidate, listCandidateSources, listCandidates, listRevisions } from "@/server/repositories/candidates";
import { listAudit, listItems, listMarkets, listSources } from "@/server/repositories/others";
import { createMarketFromCandidate } from "@/server/workflow/createMarket";
import { approveCandidate, editCandidate, rejectCandidate, reopenCandidate } from "@/server/workflow/review";
import { freshDb, SAMPLE_RSS, stubFetch } from "../helpers";

const run = (db: Db, extra: Partial<Parameters<typeof runDiscovery>[0]> = {}) =>
  runDiscovery({ db, trigger: "manual", actor: "tester", skipCooldown: true, analyzer: new HeuristicAnalyzer(), fetchImpl: stubFetch({}), ...extra });

async function byQuestion(db: Db, re: RegExp) {
  const c = (await listCandidates(db)).find((x) => re.test(x.question));
  if (!c) throw new Error(`no candidate matching ${re}`);
  return c;
}

describe("discovery pipeline", () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb({ onlyFixture: true });
  });

  it("creates reviewable candidates from the fixture feed and never auto-approves", async () => {
    const r = await run(db);
    expect(r.status).toBe("completed");
    expect(r.stats.candidatesCreated).toBeGreaterThanOrEqual(5);
    const all = await listCandidates(db);
    expect(all.every((c) => c.status === "pending_review")).toBe(true);
    const items = await listItems(db);
    expect(items.find((i) => i.title.startsWith("In pictures"))?.status).toBe("skipped");
    expect(items.find((i) => i.title.startsWith("Opinion"))?.status).toBe("skipped");
  });

  it("merges a second report of the same event and flags the conflicting date", async () => {
    await run(db);
    const starship = await byQuestion(db, /Starship/);
    const sources = await listCandidateSources(db, starship.id);
    expect(sources).toHaveLength(2);
    expect(starship.validation.issues.map((i) => i.code)).toContain("CONFLICTING_SOURCES");
    expect((await listAudit(db, { entityId: starship.id })).map((e) => e.action)).toContain("evidence_added");
  });

  it("blocks a candidate that duplicates a live market", async () => {
    await run(db);
    const btc = await byQuestion(db, /Bitcoin/);
    expect(btc.validation.issues.find((i) => i.code === "DUPLICATE_MARKET")?.severity).toBe("blocker");
  });

  it("does not re-ingest or re-analyze the same articles on the next run", async () => {
    await run(db);
    const before = (await listCandidates(db)).length;
    const r2 = await run(db);
    expect(r2.stats.itemsNew).toBe(0);
    expect(r2.stats.candidatesCreated).toBe(0);
    expect((await listCandidates(db)).length).toBe(before);
  });

  it("isolates a failing source and records its health", async () => {
    await db.query("UPDATE sources SET enabled = TRUE WHERE slug IN ('legacy-wire', 'bbc-business')");
    const r = await run(db, { fetchImpl: stubFetch({ "https://feeds.bbci.co.uk/news/business/rss.xml": { body: SAMPLE_RSS } }) });
    expect(r.status).toBe("completed_with_errors");
    expect(r.stats.sourcesFailed).toBe(1);
    expect(r.stats.sourcesOk).toBe(2);
    const legacy = (await listSources(db)).find((s) => s.slug === "legacy-wire")!;
    expect(legacy.lastStatus).toBe("error");
    expect(legacy.consecutiveFailures).toBe(1);
    expect(legacy.lastError).toMatch(/ENOTFOUND/);
  });

  it("marks items failed when the LLM breaks, and lets a reviewer re-queue them", async () => {
    const broken: Analyzer = { name: "broken", analyze: async () => { throw new LlmError("Model output failed schema validation twice", "invalid_output", true); } };
    const r = await run(db, { analyzer: broken, maxItems: 2 });
    expect(r.status).toBe("completed_with_errors");
    expect(r.stats.itemsFailed).toBe(2);
    expect(await listCandidates(db)).toHaveLength(0);
    const failed = (await listItems(db)).filter((i) => i.status === "failed");
    expect(failed).toHaveLength(2);
    await requeueItem(db, failed[0].id, "tester");
    await run(db, { maxItems: 1 });
    expect((await listItems(db)).find((i) => i.id === failed[0].id)?.status).toMatch(/candidate|merged/);
  });

  it("refuses to start a second concurrent run", async () => {
    await db.query("INSERT INTO discovery_runs (id, trigger, triggered_by, status, analyzer) VALUES ('run_x','manual','a','running','h')");
    await expect(run(db)).rejects.toMatchObject({ code: "RUN_IN_PROGRESS" });
  });
});

describe("review → market", () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb({ onlyFixture: true });
    await run(db);
  });

  it("edits with revision history, then enforces optimistic locking", async () => {
    const c = await byQuestion(db, /European Parliament/);
    const edited = await editCandidate(db, c.id, c.version, { question: "Will the European Parliament adopt the AI Liability Directive in its plenary vote on October 19, 2026?" }, "alice");
    expect(edited.version).toBe(c.version + 1);
    const revs = await listRevisions(db, c.id);
    expect(revs[0].changes.question.to).toMatch(/adopt/);
    await expect(editCandidate(db, c.id, c.version, { description: "stale write" }, "bob")).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  });

  it("rejects invalid edits with field errors", async () => {
    const c = await byQuestion(db, /European Parliament/);
    await expect(editCandidate(db, c.id, c.version, { resolutionSourceUrl: "not-a-url" }, "alice")).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("will not approve with blockers, requires warning acknowledgement, and creates exactly one market", async () => {
    const btc = await byQuestion(db, /Bitcoin/);
    await expect(approveCandidate(db, btc.id, { expectedVersion: btc.version, acknowledgeWarnings: true }, "alice")).rejects.toMatchObject({ code: "BLOCKING_ISSUES" });

    const c = await byQuestion(db, /European Parliament/);
    await expect(createMarketFromCandidate(db, c.id, "alice")).rejects.toMatchObject({ code: "NOT_APPROVED" });
    await expect(approveCandidate(db, c.id, { expectedVersion: c.version }, "alice")).rejects.toMatchObject({ code: "WARNINGS_NOT_ACKNOWLEDGED" });
    const approved = await approveCandidate(db, c.id, { expectedVersion: c.version, acknowledgeWarnings: true, note: "checked" }, "alice");
    expect(approved.status).toBe("approved");
    expect(approved.reviewedBy).toBe("alice");

    const [first, second] = await Promise.all([createMarketFromCandidate(db, c.id, "alice"), createMarketFromCandidate(db, c.id, "alice")]);
    expect(first.market.externalId).toBe(second.market.externalId);
    const created = (await listMarkets(db)).filter((m) => !m.isSeed);
    expect(created).toHaveLength(1);
    const { rows } = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM omx_markets");
    expect(rows[0].n).toBe(1);

    // Provenance: the original article URL survives into the market payload.
    const item = (await listItems(db)).find((i) => i.candidateId === c.id)!;
    expect(created[0].payload.provenance.sources.map((s) => s.url)).toContain(item.url);
    expect(created[0].payload.provenance.approvedBy).toBe("alice");

    const final = await getCandidate(db, c.id);
    expect(final?.status).toBe("market_created");
    await expect(editCandidate(db, c.id, final!.version, { description: "x" }, "alice")).rejects.toMatchObject({ code: "LOCKED" });
  });

  it("sends an approved candidate back to review when it is edited", async () => {
    const c = await byQuestion(db, /Federal Reserve/);
    const a = await approveCandidate(db, c.id, { expectedVersion: c.version, acknowledgeWarnings: true }, "alice");
    const e = await editCandidate(db, c.id, a.version, { description: `${c.description} Updated.` }, "bob");
    expect(e.status).toBe("pending_review");
    expect(e.reviewedBy).toBeNull();
  });

  it("supports reject → reopen and enforces the state machine", async () => {
    const c = await byQuestion(db, /Nimbus/);
    const r = await rejectCandidate(db, c.id, { expectedVersion: c.version, reason: "Low trader interest" }, "alice");
    expect(r.status).toBe("rejected");
    await expect(approveCandidate(db, c.id, { expectedVersion: r.version, acknowledgeWarnings: true }, "alice")).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    const reopened = await reopenCandidate(db, c.id, { expectedVersion: r.version }, "alice");
    expect(reopened.status).toBe("pending_review");
  });
});

describe("mock OmniMarketX API", () => {
  it("validates payloads and honours idempotency keys", async () => {
    const db = await freshDb();
    await expect(mockCreateMarket(db, {}, "key-12345678")).rejects.toMatchObject({ status: 422 });
    await expect(mockCreateMarket(db, {}, null)).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REQUIRED" });
    const payload = {
      title: "Will the test market resolve yes by 2099?",
      slug: "test-market",
      description: "",
      category: "Other",
      marketType: "binary",
      outcomes: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }],
      closesAt: "2099-01-01T00:00:00.000Z",
      expectedResolutionAt: "2099-01-02T00:00:00.000Z",
      resolution: { criteria: "Resolves yes if the thing happens by the deadline.", source: { name: "x", url: "https://x.gov" } },
      tags: [],
      provenance: { candidateId: "c", candidateVersion: 1, generator: "g", approvedBy: "a", approvedAt: "2026-01-01T00:00:00Z", sources: [] },
    };
    const a = await mockCreateMarket(db, payload, "key-12345678");
    const b = await mockCreateMarket(db, payload, "key-12345678");
    expect(a.idempotentReplay).toBe(false);
    expect(b).toMatchObject({ id: a.id, idempotentReplay: true });
  });
});
