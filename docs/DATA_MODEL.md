# Data model

PostgreSQL schema, defined as versioned migrations in `src/server/db/schema.ts` and applied automatically
(advisory-locked) on first request.

```
sources 1──* source_items *──1 discovery_runs
                  │
                  │ (M:N via candidate_sources: role + facts)
                  ▼
             candidates 1──* candidate_revisions
                  │      1──* audit_events (entity_type='candidate')
                  │
                  1──0..1 markets ── payload.provenance (snapshot of sources)
                                  └─ external_id → omx_markets (mock external system)
```

## Tables

### `sources`
Configurable inputs. `type` = `rss` | `fixture`; `reliability` = `official` | `major_media` | `aggregator` |
`community` | `synthetic` (used by validation); health fields `last_status`, `last_error`,
`consecutive_failures`, `last_fetched_at`.

### `discovery_runs`
One row per run: `trigger` (manual/cron), `triggered_by`, `status` (`running`, `completed`,
`completed_with_errors`, `failed`), `analyzer`, `stats` (JSONB counters), `log` (JSONB entries), `error`.
A **partial unique index** on `status WHERE status = 'running'` guarantees at most one active run even with
concurrent serverless invocations. Runs stuck in `running` > 10 min are expired.

### `source_items`
Every ingested article. `url_hash` = SHA-256 of the canonical URL (lowercase host, no `www`, no fragment,
tracking params removed, sorted query) — **UNIQUE**, so re-fetching the same article is a no-op.
`content_hash` for future content-level dedupe. `raw` keeps the feed item + prefilter reasons,
`analysis` keeps the analyzer's raw JSON draft and generator id. `status`:

| status | meaning |
|---|---|
| `new` | stored, waiting for analysis (backlog carries over between runs) |
| `skipped` | prefilter score below threshold (reason stored) |
| `unsuitable` | analyzer judged it not to be a market (reason stored) |
| `candidate` | produced a new candidate |
| `merged` | attached to an existing candidate as evidence |
| `clustered` | same story as another item in the run |
| `failed` | analysis failed (e.g. LLM output invalid) — re-queueable from the UI |

### `candidates`
The structured market proposal: `question`, `category`, `description`, `outcome_type`, `outcomes` (JSONB),
`event_date`, `close_date`, `resolution_criteria`, `resolution_source_name/url`, `tags`, `event_key`
(stable slug of the underlying event, e.g. `fed-fomc-rate-decision-2026-10`), `confidence`, `ai_rationale`,
`ambiguity_notes`, `generator` (e.g. `groq:llama-3.3-70b-versatile@<prompt-version>`), `validation` (latest
report JSON) + `quality_score`, `status`, `version` (optimistic lock), review fields, `run_id`.

### `candidate_sources`
M:N link with `role` (`primary`, `supporting`, `conflicting`) and `facts` — what *this* article claims
(e.g. `eventDate`, key claims). Facts from different sources are compared to detect conflicts.

### `candidate_revisions`
One row per edit: `version`, `changed_by`, `changes` = `{field: {from, to}}`.

### `markets`
Local record of created markets. `candidate_id` **UNIQUE** (one market per candidate), `external_id` from the
market API, `payload` = exact payload sent (including provenance). `is_seed` marks pre-existing markets used by
duplicate detection.

### `omx_markets`
Storage of the **mock** OmniMarketX service. `idempotency_key` **UNIQUE**.

### `audit_events`
Append-only log: `entity_type`, `entity_id`, `action`, `actor` (reviewer name or `system:discovery`), `details`.

## How source information maps into a candidate

| Source item | → | Candidate |
|---|---|---|
| title, summary (+ clustered related coverage) | LLM / heuristic | question, description, outcomes, dates, resolution, event key |
| article-reported event date | `candidate_sources.facts.eventDate` | conflict detection |
| URL, publisher, published time, reliability | link row + joins | evidence panel, validation (stale / weak / single source) |
| raw analyzer JSON | `source_items.analysis` | "Analyzer output" panel |

## Candidate status

```
pending_review ──approve──► approved ──create market──► market_created (final)
      │  ▲                     │  │
      │  └──edit / reopen / new conflicting evidence──┘
      └──reject──► rejected ──reopen──► pending_review
approved ──reject──► rejected
```
Transitions are enforced in `workflow/review.ts` (`TRANSITIONS`) and the DB `CHECK` constraint.

## Duplicates and repeated discoveries

1. **Same article again** → unique `url_hash`, ignored at insert.
2. **Same story, different feeds, same run** → title similarity ≥ 0.55 → clustered, analysed once.
3. **Same event, later article** → merge rule (event-key token overlap ≥ 0.6 and dates within 45 days, or
   question similarity ≥ 0.72) → attached as evidence; audit `evidence_added`; conflicts flagged.
   Rejected candidates are merge targets too, so rejected events are not re-proposed every run.
4. **Same as a live market** → `DUPLICATE_MARKET` blocker (similarity ≥ 0.72, date-adjusted).

## Verifying that source information survives

The integration test `review → market › … creates exactly one market` asserts that the original article URL
of the candidate's source item appears in `markets.payload.provenance.sources`, together with `approvedBy`.
The e2e test checks the provenance is visible on the market page.
