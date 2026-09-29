import type { Candidate, CandidateSourceLink, CandidateStatus, Revision, SourceFacts, ValidationReport } from "@/lib/domain";
import type { Queryable } from "../db/client";
import { newId } from "../ids";
import { toCandidate, toCandidateSource, toRevision } from "./mappers";

const SELECT = `
  SELECT c.*,
    (SELECT count(*)::int FROM candidate_sources cs WHERE cs.candidate_id = c.id) AS source_count,
    (SELECT m.id FROM markets m WHERE m.candidate_id = c.id) AS market_id
  FROM candidates c`;

export interface NewCandidate {
  question: string;
  category: string;
  description: string;
  outcomeType: "binary" | "multiple";
  outcomes: { label: string; description?: string }[];
  eventDate: string | null;
  closeDate: string | null;
  resolutionCriteria: string;
  resolutionSourceName: string;
  resolutionSourceUrl: string;
  tags: string[];
  eventKey: string;
  confidence: number | null;
  aiRationale: string;
  ambiguityNotes: string[];
  generator: string;
  validation: ValidationReport;
  runId: string | null;
}

export async function insertCandidate(q: Queryable, c: NewCandidate): Promise<string> {
  const id = newId("cand");
  await q.query(
    `INSERT INTO candidates (id, question, category, description, outcome_type, outcomes, event_date, close_date,
       resolution_criteria, resolution_source_name, resolution_source_url, tags, event_key, confidence, ai_rationale,
       ambiguity_notes, generator, validation, quality_score, run_id)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16::jsonb,$17,$18::jsonb,$19,$20)`,
    [
      id, c.question, c.category, c.description, c.outcomeType, JSON.stringify(c.outcomes), c.eventDate, c.closeDate,
      c.resolutionCriteria, c.resolutionSourceName, c.resolutionSourceUrl, JSON.stringify(c.tags), c.eventKey,
      c.confidence, c.aiRationale, JSON.stringify(c.ambiguityNotes), c.generator, JSON.stringify(c.validation),
      c.validation.score, c.runId,
    ],
  );
  return id;
}

export async function getCandidate(q: Queryable, id: string): Promise<Candidate | null> {
  const { rows } = await q.query(`${SELECT} WHERE c.id = $1`, [id]);
  return rows[0] ? toCandidate(rows[0]) : null;
}

export interface CandidateFilter {
  status?: CandidateStatus | "all";
  category?: string;
  search?: string;
  sort?: "score" | "newest" | "closing";
  limit?: number;
}

export async function listCandidates(q: Queryable, f: CandidateFilter = {}): Promise<Candidate[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.status && f.status !== "all") {
    params.push(f.status);
    where.push(`c.status = $${params.length}`);
  }
  if (f.category) {
    params.push(f.category);
    where.push(`c.category = $${params.length}`);
  }
  if (f.search) {
    params.push(`%${f.search.toLowerCase()}%`);
    where.push(`(lower(c.question) LIKE $${params.length} OR lower(c.description) LIKE $${params.length})`);
  }
  const order =
    f.sort === "newest" ? "c.created_at DESC" : f.sort === "closing" ? "c.close_date ASC NULLS LAST" : "c.quality_score DESC, c.created_at DESC";
  params.push(Math.min(f.limit ?? 200, 500));
  const { rows } = await q.query(
    `${SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY ${order} LIMIT $${params.length}`,
    params,
  );
  return rows.map(toCandidate);
}

export async function countByStatus(q: Queryable): Promise<Record<string, number>> {
  const { rows } = await q.query<{ status: string; n: number }>("SELECT status, count(*)::int AS n FROM candidates GROUP BY status");
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
}

/** Candidates used for duplicate detection and merge targeting. */
export async function listForDedupe(q: Queryable, excludeId?: string) {
  const { rows } = await q.query<{ id: string; question: string; event_date: Date | string | null; event_key: string; status: string }>(
    `SELECT id, question, event_date, event_key, status FROM candidates
     WHERE ($1::text IS NULL OR id <> $1) ORDER BY created_at DESC LIMIT 500`,
    [excludeId ?? null],
  );
  return rows.map((r) => ({
    id: r.id,
    question: r.question,
    eventDate: r.event_date ? new Date(r.event_date).toISOString() : null,
    eventKey: r.event_key,
    status: r.status,
  }));
}

const COLUMN: Record<string, string> = {
  question: "question",
  category: "category",
  description: "description",
  outcomeType: "outcome_type",
  outcomes: "outcomes",
  eventDate: "event_date",
  closeDate: "close_date",
  resolutionCriteria: "resolution_criteria",
  resolutionSourceName: "resolution_source_name",
  resolutionSourceUrl: "resolution_source_url",
  tags: "tags",
};
const JSON_COLUMNS = new Set(["outcomes", "tags"]);

/**
 * Optimistic-locked update. Returns false if `expectedVersion` no longer matches (someone else
 * edited the candidate first), in which case nothing is written.
 */
export async function updateCandidate(
  q: Queryable,
  id: string,
  expectedVersion: number,
  fields: Record<string, unknown>,
  extra: { validation?: ValidationReport; status?: CandidateStatus; reviewedBy?: string | null; reviewNote?: string | null; reviewedAt?: string | null } = {},
): Promise<boolean> {
  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (col: string, value: unknown, cast = "") => {
    params.push(value);
    sets.push(`${col} = $${params.length}${cast}`);
  };
  for (const [key, value] of Object.entries(fields)) {
    const col = COLUMN[key];
    if (!col) continue;
    if (JSON_COLUMNS.has(key)) set(col, JSON.stringify(value), "::jsonb");
    else set(col, value);
  }
  if (extra.validation) {
    set("validation", JSON.stringify(extra.validation), "::jsonb");
    set("quality_score", extra.validation.score);
  }
  if (extra.status) set("status", extra.status);
  if (extra.reviewedBy !== undefined) set("reviewed_by", extra.reviewedBy);
  if (extra.reviewNote !== undefined) set("review_note", extra.reviewNote);
  if (extra.reviewedAt !== undefined) set("reviewed_at", extra.reviewedAt);
  sets.push("version = version + 1", "updated_at = now()");
  params.push(id, expectedVersion);
  const { rows } = await q.query(
    `UPDATE candidates SET ${sets.join(", ")} WHERE id = $${params.length - 1} AND version = $${params.length} RETURNING id`,
    params,
  );
  return rows.length === 1;
}

/** Validation refresh that does not bump the version (system-side recomputation). */
export async function refreshValidation(q: Queryable, id: string, validation: ValidationReport): Promise<void> {
  await q.query("UPDATE candidates SET validation = $1::jsonb, quality_score = $2 WHERE id = $3", [JSON.stringify(validation), validation.score, id]);
}

export async function linkSource(q: Queryable, candidateId: string, itemId: string, role: CandidateSourceLink["role"], facts: SourceFacts): Promise<boolean> {
  const { rows } = await q.query(
    `INSERT INTO candidate_sources (candidate_id, item_id, role, facts) VALUES ($1,$2,$3,$4::jsonb)
     ON CONFLICT (candidate_id, item_id) DO NOTHING RETURNING item_id`,
    [candidateId, itemId, role, JSON.stringify(facts)],
  );
  return rows.length === 1;
}

export async function listCandidateSources(q: Queryable, candidateId: string): Promise<CandidateSourceLink[]> {
  const { rows } = await q.query(
    `SELECT cs.*, i.title, i.url, i.summary, i.published_at, s.name AS source_name, s.reliability AS source_reliability
     FROM candidate_sources cs
     JOIN source_items i ON i.id = cs.item_id
     JOIN sources s ON s.id = i.source_id
     WHERE cs.candidate_id = $1
     ORDER BY CASE cs.role WHEN 'primary' THEN 0 WHEN 'supporting' THEN 1 ELSE 2 END, cs.added_at`,
    [candidateId],
  );
  return rows.map(toCandidateSource);
}

export async function insertRevision(q: Queryable, candidateId: string, version: number, changedBy: string, changes: Revision["changes"]): Promise<void> {
  await q.query(
    "INSERT INTO candidate_revisions (id, candidate_id, version, changed_by, changes) VALUES ($1,$2,$3,$4,$5::jsonb)",
    [newId("rev"), candidateId, version, changedBy, JSON.stringify(changes)],
  );
}

export async function listRevisions(q: Queryable, candidateId: string): Promise<Revision[]> {
  const { rows } = await q.query("SELECT * FROM candidate_revisions WHERE candidate_id = $1 ORDER BY version DESC", [candidateId]);
  return rows.map(toRevision);
}
