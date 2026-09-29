/** Row → DTO mapping. Keeps snake_case SQL rows out of the rest of the codebase. */
import type {
  AuditEvent,
  Candidate,
  CandidateSourceLink,
  DiscoveryRun,
  Market,
  Revision,
  Source,
  SourceItem,
} from "@/lib/domain";

type Row = Record<string, unknown>;

export function iso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function json<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}

export function toCandidate(r: Row): Candidate {
  return {
    id: String(r.id),
    question: String(r.question),
    category: r.category as Candidate["category"],
    description: String(r.description ?? ""),
    outcomeType: r.outcome_type as Candidate["outcomeType"],
    outcomes: json(r.outcomes, []),
    eventDate: iso(r.event_date),
    closeDate: iso(r.close_date),
    resolutionCriteria: String(r.resolution_criteria ?? ""),
    resolutionSourceName: String(r.resolution_source_name ?? ""),
    resolutionSourceUrl: String(r.resolution_source_url ?? ""),
    tags: json(r.tags, []),
    eventKey: String(r.event_key ?? ""),
    status: r.status as Candidate["status"],
    confidence: r.confidence === null || r.confidence === undefined ? null : Number(r.confidence),
    aiRationale: String(r.ai_rationale ?? ""),
    ambiguityNotes: json(r.ambiguity_notes, []),
    generator: String(r.generator ?? ""),
    validation: json(r.validation, { issues: [], score: 0, blockers: 0, warnings: 0, checkedAt: "" }),
    version: Number(r.version),
    reviewNote: (r.review_note as string) ?? null,
    reviewedBy: (r.reviewed_by as string) ?? null,
    reviewedAt: iso(r.reviewed_at),
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
    sourceCount: Number(r.source_count ?? 0),
    marketId: (r.market_id as string) ?? null,
  };
}

export function toCandidateSource(r: Row): CandidateSourceLink {
  return {
    itemId: String(r.item_id),
    role: r.role as CandidateSourceLink["role"],
    facts: json(r.facts, {}),
    addedAt: iso(r.added_at)!,
    title: String(r.title),
    url: String(r.url),
    summary: String(r.summary ?? ""),
    publishedAt: iso(r.published_at),
    sourceName: String(r.source_name ?? ""),
    sourceReliability: r.source_reliability as CandidateSourceLink["sourceReliability"],
  };
}

export function toSource(r: Row): Source {
  return {
    id: String(r.id),
    slug: String(r.slug),
    name: String(r.name),
    type: r.type as Source["type"],
    url: String(r.url),
    categoryHint: (r.category_hint as Source["categoryHint"]) ?? null,
    reliability: r.reliability as Source["reliability"],
    enabled: Boolean(r.enabled),
    lastFetchedAt: iso(r.last_fetched_at),
    lastStatus: (r.last_status as Source["lastStatus"]) ?? null,
    lastError: (r.last_error as string) ?? null,
    consecutiveFailures: Number(r.consecutive_failures ?? 0),
    itemCount: Number(r.item_count ?? 0),
    createdAt: iso(r.created_at)!,
  };
}

export function toItem(r: Row): SourceItem {
  return {
    id: String(r.id),
    sourceId: String(r.source_id),
    sourceName: String(r.source_name ?? ""),
    runId: (r.run_id as string) ?? null,
    url: String(r.url),
    title: String(r.title),
    summary: String(r.summary ?? ""),
    publishedAt: iso(r.published_at),
    fetchedAt: iso(r.fetched_at)!,
    status: r.status as SourceItem["status"],
    prefilterScore: Number(r.prefilter_score ?? 0),
    reason: (r.reason as string) ?? null,
    candidateId: (r.candidate_id as string) ?? null,
  };
}

export function toRun(r: Row): DiscoveryRun {
  return {
    id: String(r.id),
    trigger: r.trigger as DiscoveryRun["trigger"],
    triggeredBy: String(r.triggered_by),
    status: r.status as DiscoveryRun["status"],
    analyzer: String(r.analyzer),
    startedAt: iso(r.started_at)!,
    finishedAt: iso(r.finished_at),
    stats: json(r.stats, {} as DiscoveryRun["stats"]),
    log: json(r.log, []),
    error: (r.error as string) ?? null,
  };
}

export function toMarket(r: Row): Market {
  return {
    id: String(r.id),
    candidateId: (r.candidate_id as string) ?? "",
    externalId: String(r.external_id),
    externalUrl: String(r.external_url),
    slug: String(r.slug),
    question: String(r.question),
    category: String(r.category),
    status: String(r.status),
    payload: json(r.payload, {} as Market["payload"]),
    createdBy: String(r.created_by),
    createdAt: iso(r.created_at)!,
    isSeed: Boolean(r.is_seed),
  };
}

export function toAudit(r: Row): AuditEvent {
  return {
    id: String(r.id),
    entityType: String(r.entity_type),
    entityId: String(r.entity_id),
    action: String(r.action),
    actor: String(r.actor),
    details: json(r.details, {}),
    createdAt: iso(r.created_at)!,
  };
}

export function toRevision(r: Row): Revision {
  return {
    id: String(r.id),
    candidateId: String(r.candidate_id),
    version: Number(r.version),
    changedBy: String(r.changed_by),
    changes: json(r.changes, {}),
    createdAt: iso(r.created_at)!,
  };
}
