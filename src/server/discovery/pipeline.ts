/**
 * Discovery pipeline: Sources → items → prefilter → cluster → analyze → dedupe/merge → candidate.
 *
 * Design notes
 *  - Each source is fetched independently; one failing feed never fails the run (status becomes
 *    `completed_with_errors` and the source's health is updated).
 *  - Items are de-duplicated on canonical-URL hash at insert time (repeated ingestion is free).
 *  - Only items with status `new` are analyzed, highest prefilter score first, capped per run to
 *    respect LLM free-tier quotas. Unprocessed items stay `new` and are picked up by the next run.
 *  - Stories covered by several feeds in one run are clustered and analyzed once.
 *  - A suitable draft is merged into an existing candidate when it describes the same event
 *    (same/similar event key and close dates, or very similar question); otherwise a new candidate
 *    is created. Merging adds evidence and can surface conflicts (different reported dates).
 *  - Nothing here can approve or publish: every candidate starts as `pending_review`.
 */
import type { DiscoveryRun, ReliabilityTier, RunLogEntry, RunStats, Source } from "@/lib/domain";
import { jaccard, questionSimilarity, textSimilarity } from "@/lib/similarity";
import { validateCandidate } from "@/lib/validation";
import { config } from "../config";
import type { Db } from "../db/client";
import { AppError } from "../http/errors";
import { logger } from "../logger";
import { createAnalyzer, LlmError, type AnalysisDraft, type Analyzer } from "../llm";
import { getCandidate, insertCandidate, linkSource, listForDedupe, updateCandidate } from "../repositories/candidates";
import {
  audit,
  createRun,
  expireStaleRuns,
  finishRun,
  getItemWithSource,
  insertItemIfNew,
  latestRunWithin,
  listSources,
  recordSourceFetch,
  saveRunProgress,
  setItemStatus,
} from "../repositories/others";
import { contentHash, fetchSourceItems, urlHash } from "../sources/fetcher";
import { SourceFetchError } from "../sources/types";
import { findSimilar, revalidateCandidate } from "../workflow/context";
import { prefilterScore } from "./signals";

export type DiscoveryEvent =
  | { type: "run_started"; runId: string; analyzer: string; sources: number }
  | { type: "log"; level: RunLogEntry["level"]; message: string }
  | { type: "source"; sourceId: string; name: string; ok: boolean; fetched: number; fresh: number; error?: string }
  | { type: "item"; itemId: string; title: string; status: string; reason?: string; candidateId?: string }
  | { type: "candidate"; candidateId: string; question: string; score: number; merged: boolean }
  | { type: "run_finished"; runId: string; status: DiscoveryRun["status"]; stats: RunStats };

export interface RunDiscoveryOptions {
  db: Db;
  trigger: "manual" | "cron";
  actor: string;
  analyzer?: Analyzer;
  fetchImpl?: typeof fetch;
  now?: Date;
  emit?: (e: DiscoveryEvent) => void;
  maxItems?: number;
  /** Stop starting new analyses after this many ms (serverless time budget). */
  budgetMs?: number;
  skipCooldown?: boolean;
}

const DAY = 86_400_000;

function emptyStats(): RunStats {
  return {
    sourcesOk: 0,
    sourcesFailed: 0,
    itemsFetched: 0,
    itemsNew: 0,
    itemsSkipped: 0,
    itemsAnalyzed: 0,
    itemsUnsuitable: 0,
    itemsFailed: 0,
    itemsClustered: 0,
    candidatesCreated: 0,
    candidatesMerged: 0,
  };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Serialises async sections (merge-or-create must see earlier results of the same run). */
function createMutex() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn);
    tail = run.catch(() => undefined);
    return run;
  };
}

function keyTokens(key: string): string[] {
  return key.split("-").filter((t) => t && !/^\d+$/.test(t));
}

type DedupeRow = Awaited<ReturnType<typeof listForDedupe>>[number];

/** Finds an existing candidate describing the same underlying event. */
export function findMergeTarget(
  existing: DedupeRow[],
  draft: { question: string; eventDate: string | null; eventKey: string },
): { target: DedupeRow; score: number } | null {
  let best: { target: DedupeRow; score: number } | null = null;
  for (const e of existing) {
    let score = questionSimilarity(draft, e);
    const kt = jaccard(keyTokens(draft.eventKey), keyTokens(e.eventKey));
    const datesClose = !draft.eventDate || !e.eventDate || Math.abs(Date.parse(draft.eventDate) - Date.parse(e.eventDate)) <= 45 * DAY;
    if (kt >= 0.6 && datesClose) score = Math.max(score, 0.75 + (kt - 0.6) / 4);
    if (score >= 0.72 && (!best || score > best.score)) best = { target: e, score };
  }
  return best;
}

interface WorkItem {
  id: string;
  title: string;
  summary: string;
  url: string;
  publishedAt: string | null;
  sourceName: string;
  reliability: ReliabilityTier;
  categoryHint: Source["categoryHint"];
  score: number;
}

/** Normalises an analyzer draft into candidate fields, filling safe defaults. */
export function normalizeDraft(d: AnalysisDraft) {
  let outcomes = d.outcomes.map((o) => ({ label: o.label.trim(), ...(o.description ? { description: o.description } : {}) })).filter((o) => o.label);
  if (d.outcomeType === "binary" && outcomes.length !== 2) outcomes = [{ label: "Yes" }, { label: "No" }];
  let closeDate = d.closeDate ?? null;
  if (!closeDate && d.eventDate) closeDate = new Date(Date.parse(d.eventDate) - 3_600_000).toISOString();
  const eventKey =
    d.eventKey?.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "") ||
    d.question.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60);
  return {
    question: d.question.trim(),
    category: d.category,
    description: d.description.trim(),
    outcomeType: d.outcomeType,
    outcomes,
    eventDate: d.eventDate ?? null,
    closeDate,
    resolutionCriteria: d.resolutionCriteria.trim(),
    resolutionSourceName: d.resolutionSourceName.trim(),
    resolutionSourceUrl: /^https?:\/\//.test(d.resolutionSourceUrl.trim()) ? d.resolutionSourceUrl.trim() : "",
    tags: [...new Set(d.tags.map((t) => t.toLowerCase().trim()).filter(Boolean))].slice(0, 5),
    eventKey,
  };
}

export async function runDiscovery(opts: RunDiscoveryOptions): Promise<{ runId: string; status: DiscoveryRun["status"]; stats: RunStats }> {
  const { db } = opts;
  const now = opts.now ?? new Date();
  const started = Date.now();
  const budgetMs = opts.budgetMs ?? 45_000;
  const maxItems = opts.maxItems ?? config.maxItemsPerRun;
  const analyzer = opts.analyzer ?? createAnalyzer();
  const stats = emptyStats();
  const log: RunLogEntry[] = [];
  const emit = (e: DiscoveryEvent) => {
    try {
      opts.emit?.(e);
    } catch {
      /* client went away; keep working */
    }
  };
  const note = (level: RunLogEntry["level"], message: string) => {
    log.push({ at: new Date().toISOString(), level, message });
    emit({ type: "log", level, message });
  };

  await expireStaleRuns(db);
  if (!opts.skipCooldown) {
    const recent = await latestRunWithin(db, Math.max(config.discoveryCooldownSec, 1));
    if (recent?.status === "running") throw new AppError(409, "RUN_IN_PROGRESS", "A discovery run is already in progress.");
    if (recent) throw new AppError(429, "COOLDOWN", `Please wait ${config.discoveryCooldownSec}s between discovery runs.`);
  }

  let runId: string;
  try {
    runId = await createRun(db, { trigger: opts.trigger, triggeredBy: opts.actor, analyzer: analyzer.name });
  } catch (err) {
    if (/duplicate key|unique/i.test((err as Error).message)) throw new AppError(409, "RUN_IN_PROGRESS", "A discovery run is already in progress.");
    throw err;
  }

  try {
    const sources = await listSources(db, true);
    emit({ type: "run_started", runId, analyzer: analyzer.name, sources: sources.length });
    note("info", `Run started with ${sources.length} enabled source(s); analyzer: ${analyzer.name}.`);

    /* 1. Fetch every source independently. */
    await mapLimit(sources, 4, async (source) => {
      try {
        const raw = await fetchSourceItems(source, { fetchImpl: opts.fetchImpl, now });
        let fresh = 0;
        for (const it of raw) {
          const pf = prefilterScore(it.title, it.summary, now);
          const id = await insertItemIfNew(db, {
            sourceId: source.id,
            runId,
            externalId: it.externalId,
            url: it.url,
            urlHash: urlHash(it.url),
            contentHash: contentHash(it),
            title: it.title,
            summary: it.summary,
            publishedAt: it.publishedAt,
            raw: { ...it, prefilterReasons: pf.reasons },
            prefilterScore: pf.score,
          });
          if (!id) continue;
          fresh++;
          if (pf.score < config.prefilterThreshold) {
            stats.itemsSkipped++;
            await setItemStatus(db, id, "skipped", { reason: `Low market signal (${pf.score.toFixed(2)}). ${pf.reasons.join("; ") || "No future event indicators."}` });
          }
        }
        stats.sourcesOk++;
        stats.itemsFetched += raw.length;
        stats.itemsNew += fresh;
        await recordSourceFetch(db, source.id, true);
        emit({ type: "source", sourceId: source.id, name: source.name, ok: true, fetched: raw.length, fresh });
        note("info", `${source.name}: ${raw.length} item(s), ${fresh} new.`);
      } catch (err) {
        const message = err instanceof SourceFetchError ? `${err.kind}: ${err.message}` : (err as Error).message;
        stats.sourcesFailed++;
        await recordSourceFetch(db, source.id, false, message);
        emit({ type: "source", sourceId: source.id, name: source.name, ok: false, fetched: 0, fresh: 0, error: message });
        note("warn", `${source.name} failed — ${message}. Continuing with other sources.`);
        logger.warn("discovery.source_failed", { runId, source: source.slug, message });
      }
    });

    /* 2. Backlog of unprocessed items (this run + previous runs), best first. */
    const { rows: backlogRows } = await db.query<{ id: string }>(
      `SELECT id FROM source_items WHERE status = 'new' AND fetched_at > now() - interval '7 days'
       ORDER BY prefilter_score DESC, published_at DESC NULLS LAST LIMIT 60`,
    );
    const work: WorkItem[] = [];
    for (const { id } of backlogRows) {
      const r = await getItemWithSource(db, id);
      if (!r) continue;
      work.push({
        id,
        title: String(r.title),
        summary: String(r.summary ?? ""),
        url: String(r.url),
        publishedAt: r.published_at ? new Date(r.published_at as string).toISOString() : null,
        sourceName: String(r.source_name),
        reliability: r.source_reliability as ReliabilityTier,
        categoryHint: (r.source_category_hint as Source["categoryHint"]) ?? null,
        score: Number(r.prefilter_score),
      });
    }

    /* 3. Cluster near-identical stories so each is analyzed once. */
    const clusters: { lead: WorkItem; members: WorkItem[] }[] = [];
    for (const it of work) {
      const home = clusters.find((c) => textSimilarity(c.lead.title, it.title) >= 0.55);
      if (home) home.members.push(it);
      else clusters.push({ lead: it, members: [] });
    }
    const selected = clusters.slice(0, maxItems);
    if (clusters.length > selected.length) {
      note("info", `${clusters.length - selected.length} story cluster(s) deferred to the next run (per-run analysis budget: ${maxItems}).`);
    }
    note("info", `Analyzing ${selected.length} story cluster(s).`);

    /* 4. Analyze + merge/create. */
    let halt = null as string | null;
    const existing = await listForDedupe(db);
    const serial = createMutex();

    await mapLimit(selected, 2, async ({ lead, members }) => {
      if (halt) return;
      if (Date.now() - started > budgetMs) {
        halt = "time budget reached";
        return;
      }
      emit({ type: "item", itemId: lead.id, title: lead.title, status: "analyzing" });
      let result;
      try {
        result = await analyzer.analyze(
          {
            title: lead.title,
            summary: lead.summary,
            url: lead.url,
            sourceName: lead.sourceName,
            sourceReliability: lead.reliability,
            publishedAt: lead.publishedAt,
            categoryHint: lead.categoryHint,
            related: members.map((m) => ({ title: m.title, summary: m.summary, url: m.url, sourceName: m.sourceName })),
          },
          now,
        );
      } catch (err) {
        const e = err as Error;
        stats.itemsFailed++;
        const reason = `Analysis failed: ${e.message}`;
        await setItemStatus(db, lead.id, "failed", { reason });
        emit({ type: "item", itemId: lead.id, title: lead.title, status: "failed", reason });
        note("error", `Could not analyze "${lead.title}": ${e.message}`);
        if (e instanceof LlmError && (e.kind === "auth" || e.kind === "rate_limited")) {
          halt = e.kind === "auth" ? "LLM authentication failed" : "LLM rate limit exhausted on all models";
        }
        return;
      }
      stats.itemsAnalyzed++;
      const { draft, generator } = result;

      if (!draft.suitable || !draft.question.trim()) {
        stats.itemsUnsuitable++;
        const reason = draft.unsuitableReason || draft.rationale || "Not a measurable future event.";
        await setItemStatus(db, lead.id, "unsuitable", { reason, analysis: { draft, generator } });
        for (const m of members) {
          stats.itemsClustered++;
          await setItemStatus(db, m.id, "clustered", { reason: `Same story as "${lead.title}" (judged unsuitable).` });
        }
        emit({ type: "item", itemId: lead.id, title: lead.title, status: "unsuitable", reason });
        return;
      }

      await serial(() => persistDraft());
      async function persistDraft() {
        const fields = normalizeDraft(draft);
        const facts = { eventDate: draft.facts.eventDate ?? fields.eventDate, keyClaims: draft.facts.keyClaims.slice(0, 4) };
        const merge = findMergeTarget(existing, fields);

        if (merge) {
          const target = merge.target;
          await linkSource(db, target.id, lead.id, "supporting", facts);
          for (const m of members) await linkSource(db, target.id, m.id, "supporting", { eventDate: facts.eventDate ?? null, keyClaims: [] });
          await setItemStatus(db, lead.id, "merged", {
            candidateId: target.id,
            reason: `Same event as existing candidate (${Math.round(merge.score * 100)}% match); added as supporting evidence.`,
            analysis: { draft, generator },
          });
          for (const m of members) {
            stats.itemsClustered++;
            await setItemStatus(db, m.id, "clustered", { candidateId: target.id, reason: `Same story as "${lead.title}".` });
          }
          const report = await revalidateCandidate(db, target.id);
          const conflictFound = report?.issues.some((i) => i.code === "CONFLICTING_SOURCES");
          const fresh = await getCandidate(db, target.id);
          if (fresh && conflictFound && fresh.status === "approved") {
            await updateCandidate(db, fresh.id, fresh.version, {}, { status: "pending_review", reviewedBy: null, reviewedAt: null });
            await audit(db, { entityType: "candidate", entityId: fresh.id, action: "returned_to_review", actor: "system:discovery", details: { reason: "New source conflicts with approved candidate", itemId: lead.id } });
          }
          await audit(db, {
            entityType: "candidate",
            entityId: target.id,
            action: "evidence_added",
            actor: "system:discovery",
            details: { itemId: lead.id, title: lead.title, match: merge.score, conflict: !!conflictFound, runId },
          });
          stats.candidatesMerged++;
          emit({ type: "candidate", candidateId: target.id, question: target.question, score: report?.score ?? 0, merged: true });
          note(conflictFound ? "warn" : "info", `"${lead.title}" matched existing candidate "${target.question}"${conflictFound ? " — sources now conflict" : ""}.`);
          return;
        }

        const similar = await findSimilar(db, fields);
        const sourceInfos = [lead, ...members].map((it, i) => ({
          url: it.url,
          publishedAt: it.publishedAt,
          reliability: it.reliability,
          role: "primary" as const,
          facts: i === 0 ? facts : { eventDate: null },
          sourceName: it.sourceName,
        }));
        const validation = validateCandidate(fields, {
          now,
          sources: sourceInfos,
          similar,
          ambiguityNotes: draft.ambiguityNotes,
          confidence: draft.confidence,
          generator,
        });
        const candidateId = await db.tx(async (q) => {
          const id = await insertCandidate(q, {
            ...fields,
            confidence: draft.confidence,
            aiRationale: draft.rationale,
            ambiguityNotes: draft.ambiguityNotes.slice(0, 6),
            generator,
            validation,
            runId,
          });
          await linkSource(q, id, lead.id, "primary", facts);
          for (const m of members) await linkSource(q, id, m.id, "supporting", { eventDate: null, keyClaims: [] });
          await audit(q, {
            entityType: "candidate",
            entityId: id,
            action: "created",
            actor: "system:discovery",
            details: { runId, itemId: lead.id, generator, score: validation.score, blockers: validation.blockers },
          });
          return id;
        });
        await setItemStatus(db, lead.id, "candidate", { candidateId, reason: draft.rationale || null, analysis: { draft, generator } });
        for (const m of members) {
          stats.itemsClustered++;
          await setItemStatus(db, m.id, "clustered", { candidateId, reason: `Same story as "${lead.title}".` });
        }
        existing.unshift({ id: candidateId, question: fields.question, eventDate: fields.eventDate, eventKey: fields.eventKey, status: "pending_review" });
        stats.candidatesCreated++;
        emit({ type: "candidate", candidateId, question: fields.question, score: validation.score, merged: false });
        note("info", `New candidate: "${fields.question}" (quality ${validation.score}).`);
        await saveRunProgress(db, runId, stats, log);
      }
    });

    if (halt) note("warn", `Stopped analyzing early: ${halt}. Remaining items stay queued for the next run.`);
    const status: DiscoveryRun["status"] = stats.sourcesFailed > 0 || stats.itemsFailed > 0 || halt ? "completed_with_errors" : "completed";
    note("info", `Run finished: ${stats.candidatesCreated} new candidate(s), ${stats.candidatesMerged} merged, ${stats.itemsUnsuitable} unsuitable, ${stats.itemsFailed} failed.`);
    await finishRun(db, runId, status, stats, log);
    emit({ type: "run_finished", runId, status, stats });
    logger.info("discovery.finished", { runId, status, ms: Date.now() - started, ...stats });
    return { runId, status, stats };
  } catch (err) {
    const message = (err as Error).message;
    note("error", `Run failed: ${message}`);
    await finishRun(db, runId, "failed", stats, log, message).catch(() => undefined);
    emit({ type: "run_finished", runId, status: "failed", stats });
    logger.error("discovery.failed", { runId, err });
    throw err;
  }
}

/** Puts a failed/unsuitable/skipped item back in the queue so the next run analyzes it again. */
export async function requeueItem(db: Db, itemId: string, actor: string): Promise<void> {
  const { rows } = await db.query<{ status: string }>("SELECT status FROM source_items WHERE id = $1", [itemId]);
  if (!rows[0]) throw new AppError(404, "NOT_FOUND", "Item not found");
  if (!["failed", "unsuitable", "skipped"].includes(rows[0].status)) {
    throw new AppError(409, "INVALID_STATE", `Items with status "${rows[0].status}" cannot be re-queued.`);
  }
  await db.query("UPDATE source_items SET status = 'new', reason = NULL, fetched_at = now(), prefilter_score = GREATEST(prefilter_score, 0.99) WHERE id = $1", [itemId]);
  await audit(db, { entityType: "item", entityId: itemId, action: "requeued", actor, details: { from: rows[0].status } });
}

