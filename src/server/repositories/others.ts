/** Repositories for sources, items, runs, markets and the audit log. */
import type { AuditEvent, DiscoveryRun, ItemStatus, Market, RunLogEntry, RunStats, Source, SourceItem } from "@/lib/domain";
import type { Queryable } from "../db/client";
import { newId } from "../ids";
import { toAudit, toItem, toMarket, toRun, toSource } from "./mappers";

/* ------------------------------- sources ------------------------------- */

const SOURCE_SELECT = `SELECT s.*, (SELECT count(*)::int FROM source_items i WHERE i.source_id = s.id) AS item_count FROM sources s`;

export async function listSources(q: Queryable, onlyEnabled = false): Promise<Source[]> {
  const { rows } = await q.query(`${SOURCE_SELECT} ${onlyEnabled ? "WHERE s.enabled" : ""} ORDER BY s.enabled DESC, s.created_at, s.name`);
  return rows.map(toSource);
}

export async function getSource(q: Queryable, id: string): Promise<Source | null> {
  const { rows } = await q.query(`${SOURCE_SELECT} WHERE s.id = $1`, [id]);
  return rows[0] ? toSource(rows[0]) : null;
}

export async function createSource(
  q: Queryable,
  s: { name: string; url: string; categoryHint: string | null; reliability: string },
): Promise<string> {
  const id = newId("src");
  const slug = `${s.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}-${id.slice(-4)}`;
  await q.query(
    "INSERT INTO sources (id, slug, name, type, url, category_hint, reliability, enabled) VALUES ($1,$2,$3,'rss',$4,$5,$6,TRUE)",
    [id, slug, s.name, s.url, s.categoryHint, s.reliability],
  );
  return id;
}

export async function updateSource(q: Queryable, id: string, patch: Partial<Pick<Source, "enabled" | "name" | "categoryHint" | "reliability">>): Promise<void> {
  const map: Record<string, string> = { enabled: "enabled", name: "name", categoryHint: "category_hint", reliability: "reliability" };
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!map[k] || v === undefined) continue;
    params.push(v);
    sets.push(`${map[k]} = $${params.length}`);
  }
  if (!sets.length) return;
  params.push(id);
  await q.query(`UPDATE sources SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
}

export async function deleteSource(q: Queryable, id: string): Promise<void> {
  await q.query("DELETE FROM sources WHERE id = $1 AND type <> 'fixture'", [id]);
}

export async function recordSourceFetch(q: Queryable, id: string, ok: boolean, error?: string): Promise<void> {
  await q.query(
    `UPDATE sources SET last_fetched_at = now(), last_status = $2, last_error = $3,
       consecutive_failures = CASE WHEN $2 = 'ok' THEN 0 ELSE consecutive_failures + 1 END
     WHERE id = $1`,
    [id, ok ? "ok" : "error", ok ? null : (error ?? "unknown error").slice(0, 500)],
  );
}

/* -------------------------------- items -------------------------------- */

export interface NewItem {
  sourceId: string;
  runId: string;
  externalId?: string;
  url: string;
  urlHash: string;
  contentHash: string;
  title: string;
  summary: string;
  publishedAt: string | null;
  raw: unknown;
  prefilterScore: number;
}

/** Inserts the item unless the canonical URL was already ingested. Returns the new id or null. */
export async function insertItemIfNew(q: Queryable, it: NewItem): Promise<string | null> {
  const id = newId("itm");
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO source_items (id, source_id, run_id, external_id, url, url_hash, content_hash, title, summary, published_at, raw, prefilter_score)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)
     ON CONFLICT (url_hash) DO NOTHING RETURNING id`,
    [id, it.sourceId, it.runId, it.externalId ?? null, it.url, it.urlHash, it.contentHash, it.title, it.summary, it.publishedAt, JSON.stringify(it.raw ?? {}), it.prefilterScore],
  );
  return rows[0]?.id ?? null;
}

export async function setItemStatus(
  q: Queryable,
  id: string,
  status: ItemStatus,
  opts: { reason?: string | null; candidateId?: string | null; analysis?: unknown } = {},
): Promise<void> {
  await q.query(
    `UPDATE source_items SET status = $2, reason = $3, candidate_id = COALESCE($4, candidate_id),
       analysis = COALESCE($5::jsonb, analysis) WHERE id = $1`,
    [id, status, opts.reason ?? null, opts.candidateId ?? null, opts.analysis === undefined ? null : JSON.stringify(opts.analysis)],
  );
}

const ITEM_SELECT = `SELECT i.id, i.source_id, i.run_id, i.url, i.title, i.summary, i.published_at, i.fetched_at, i.status,
  i.prefilter_score, i.reason, i.candidate_id, s.name AS source_name FROM source_items i JOIN sources s ON s.id = i.source_id`;

export async function listItems(q: Queryable, f: { runId?: string; status?: string; limit?: number } = {}): Promise<SourceItem[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.runId) {
    params.push(f.runId);
    where.push(`i.run_id = $${params.length}`);
  }
  if (f.status) {
    params.push(f.status);
    where.push(`i.status = $${params.length}`);
  }
  params.push(Math.min(f.limit ?? 200, 1000));
  const { rows } = await q.query(
    `${ITEM_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY i.fetched_at DESC, i.prefilter_score DESC LIMIT $${params.length}`,
    params,
  );
  return rows.map(toItem);
}

export async function getItemWithSource(q: Queryable, id: string) {
  const { rows } = await q.query<Record<string, unknown>>(
    `SELECT i.*, s.name AS source_name, s.reliability AS source_reliability, s.category_hint AS source_category_hint
     FROM source_items i JOIN sources s ON s.id = i.source_id WHERE i.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function countItemsByStatus(q: Queryable): Promise<Record<string, number>> {
  const { rows } = await q.query<{ status: string; n: number }>("SELECT status, count(*)::int AS n FROM source_items GROUP BY status");
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
}

/* --------------------------------- runs -------------------------------- */

export async function createRun(q: Queryable, r: { trigger: "manual" | "cron"; triggeredBy: string; analyzer: string }): Promise<string> {
  const id = newId("run");
  await q.query("INSERT INTO discovery_runs (id, trigger, triggered_by, status, analyzer) VALUES ($1,$2,$3,'running',$4)", [id, r.trigger, r.triggeredBy, r.analyzer]);
  return id;
}

export async function finishRun(q: Queryable, id: string, status: DiscoveryRun["status"], stats: RunStats, log: RunLogEntry[], error?: string): Promise<void> {
  await q.query(
    "UPDATE discovery_runs SET status = $2, stats = $3::jsonb, log = $4::jsonb, error = $5, finished_at = now() WHERE id = $1",
    [id, status, JSON.stringify(stats), JSON.stringify(log.slice(-400)), error ?? null],
  );
}

export async function saveRunProgress(q: Queryable, id: string, stats: RunStats, log: RunLogEntry[]): Promise<void> {
  await q.query("UPDATE discovery_runs SET stats = $2::jsonb, log = $3::jsonb WHERE id = $1", [id, JSON.stringify(stats), JSON.stringify(log.slice(-400))]);
}

export async function listRuns(q: Queryable, limit = 20): Promise<DiscoveryRun[]> {
  const { rows } = await q.query("SELECT * FROM discovery_runs ORDER BY started_at DESC LIMIT $1", [limit]);
  return rows.map(toRun);
}

export async function getRun(q: Queryable, id: string): Promise<DiscoveryRun | null> {
  const { rows } = await q.query("SELECT * FROM discovery_runs WHERE id = $1", [id]);
  return rows[0] ? toRun(rows[0]) : null;
}

/** Most recent run started within `withinSec` seconds (running or not). */
export async function latestRunWithin(q: Queryable, withinSec: number): Promise<DiscoveryRun | null> {
  const { rows } = await q.query(
    "SELECT * FROM discovery_runs WHERE started_at > now() - ($1::int * interval '1 second') ORDER BY started_at DESC LIMIT 1",
    [withinSec],
  );
  return rows[0] ? toRun(rows[0]) : null;
}

/** Runs stuck in 'running' (e.g. the function was killed) are closed so they don't block new runs. */
export async function expireStaleRuns(q: Queryable, olderThanSec = 600): Promise<void> {
  await q.query(
    `UPDATE discovery_runs SET status = 'failed', error = 'Run did not finish (timed out or process stopped)', finished_at = now()
     WHERE status = 'running' AND started_at < now() - ($1::int * interval '1 second')`,
    [olderThanSec],
  );
}

/* -------------------------------- markets ------------------------------ */

export async function insertMarket(
  q: Queryable,
  m: Omit<Market, "id" | "createdAt" | "isSeed"> & { eventDate: string | null },
): Promise<string> {
  const id = newId("mkt");
  await q.query(
    `INSERT INTO markets (id, candidate_id, external_id, external_url, slug, question, category, status, payload, event_date, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)`,
    [id, m.candidateId, m.externalId, m.externalUrl, m.slug, m.question, m.category, m.status, JSON.stringify(m.payload), m.eventDate, m.createdBy],
  );
  return id;
}

export async function listMarkets(q: Queryable): Promise<Market[]> {
  const { rows } = await q.query("SELECT * FROM markets ORDER BY is_seed, created_at DESC");
  return rows.map(toMarket);
}

export async function getMarket(q: Queryable, id: string): Promise<Market | null> {
  const { rows } = await q.query("SELECT * FROM markets WHERE id = $1", [id]);
  return rows[0] ? toMarket(rows[0]) : null;
}

export async function getMarketByCandidate(q: Queryable, candidateId: string): Promise<Market | null> {
  const { rows } = await q.query("SELECT * FROM markets WHERE candidate_id = $1", [candidateId]);
  return rows[0] ? toMarket(rows[0]) : null;
}

export async function listMarketsForDedupe(q: Queryable) {
  const { rows } = await q.query<{ id: string; question: string; event_date: Date | string | null; status: string; candidate_id: string | null }>(
    "SELECT id, question, event_date, status, candidate_id FROM markets ORDER BY created_at DESC LIMIT 1000",
  );
  return rows.map((r) => ({ id: r.id, question: r.question, eventDate: r.event_date ? new Date(r.event_date).toISOString() : null, status: r.status, candidateId: r.candidate_id }));
}

/* --------------------------------- audit ------------------------------- */

export async function audit(
  q: Queryable,
  e: { entityType: string; entityId: string; action: string; actor: string; details?: Record<string, unknown> },
): Promise<void> {
  await q.query(
    "INSERT INTO audit_events (id, entity_type, entity_id, action, actor, details) VALUES ($1,$2,$3,$4,$5,$6::jsonb)",
    [newId("evt"), e.entityType, e.entityId, e.action, e.actor, JSON.stringify(e.details ?? {})],
  );
}

export async function listAudit(q: Queryable, f: { entityType?: string; entityId?: string; limit?: number } = {}): Promise<AuditEvent[]> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (f.entityType) {
    params.push(f.entityType);
    where.push(`entity_type = $${params.length}`);
  }
  if (f.entityId) {
    params.push(f.entityId);
    where.push(`entity_id = $${params.length}`);
  }
  params.push(f.limit ?? 100);
  const { rows } = await q.query(
    `SELECT * FROM audit_events ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT $${params.length}`,
    params,
  );
  return rows.map(toAudit);
}
