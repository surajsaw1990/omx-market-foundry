# Architecture

## Goals that shaped the design

1. **Human in control.** Automation drafts; only an authenticated reviewer approves, and creating a market is a
   separate explicit action. Enforced server-side (state machine + auth), not just hidden buttons.
2. **Trustworthy candidates over many candidates.** Cheap filtering first, strict schemas on LLM output,
   deterministic validation, and visible reasons for every decision the system makes.
3. **Runs anywhere with zero setup, deploys to Vercel.** One Next.js app; same SQL on PGlite and Postgres.
4. **Free-tier friendly.** Bounded LLM calls per run, model fallback, backlog carried to the next run.

## Components

```
┌──────────────── Browser (React 19, SWR) ────────────────┐
│ Dashboard · Discovery (NDJSON stream) · Queue · Candidate│
│ workspace (live validation preview) · Markets · Sources  │
└───────────────▲──────────────────────────────┬──────────┘
                │ JSON / NDJSON                │ cookie session
┌───────────────┴──────────── Next.js route handlers (src/app/api) ─────────────────┐
│ api() wrapper: request id · auth · same-origin check · zod · uniform errors · logs │
└──────┬──────────────┬───────────────┬──────────────────┬──────────────────────────┘
       │              │               │                  │
┌──────▼─────┐ ┌──────▼──────┐ ┌──────▼───────┐ ┌────────▼─────────┐
│ discovery/ │ │ workflow/   │ │ markets/     │ │ repositories/    │
│ pipeline   │ │ review      │ │ publisher ───┼─► mock OMX API     │
│ signals    │ │ createMarket│ │ (interface)  │ │ SQL, row mappers │
└──┬───┬─────┘ │ context     │ └──────────────┘ └────────┬─────────┘
   │   │       └─────────────┘                           │
┌──▼┐ ┌▼─────────────┐   lib/validation.ts (pure)   ┌─────▼──────────┐
│src│ │ llm/ Groq    │   lib/similarity.ts (pure)   │ db/ pg | PGlite │
│RSS│ │ or heuristic │   shared with the browser    │ migrations+seed │
└───┘ └──────────────┘                              └─────────────────┘
```

### Why one Next.js app (not FastAPI + React)?
A single deployable on Vercel with a typed boundary shared by UI and API (`src/lib/domain.ts`). The validation
engine is a pure module used by both the server (authoritative) and the browser (live preview) — impossible to
drift. Route handlers are deliberately thin; business logic lives in `src/server/**` and is tested without HTTP.

### Why PGlite + Postgres instead of SQLite / an ORM?
PGlite is real PostgreSQL in WASM, so local runs, CI tests and the zero-config demo exercise the *same SQL*
(JSONB, partial unique indexes, advisory locks, `ON CONFLICT`) as production Postgres (Neon). Raw parameterised SQL
keeps the schema obvious and documented (see `DATA_MODEL.md`).

### Why RSS + official feeds?
They are public, legally consumable, stable, and structured. Official sources (Fed, ECB, NASA) double as
resolution sources; major outlets add breadth. A synthetic fixture feed makes demos and tests deterministic
and covers edge cases (conflicts, duplicates, opinion pieces) on demand.

## Discovery flow (`src/server/discovery/pipeline.ts`)

1. **Guard** — expire stale `running` runs; cooldown; a partial unique index guarantees one active run.
2. **Fetch** every enabled source in parallel (limit 4) with timeout, one retry for transient errors, typed
   errors. Failures update source health and never abort the run (`completed_with_errors`).
3. **Store** items with `ON CONFLICT (url_hash) DO NOTHING` → repeated ingestion is free.
4. **Prefilter** (`signals.ts`): upcoming date, forward-looking language, event keywords, numbers; negative
   patterns for opinion/galleries/live blogs. Below threshold → `skipped` with the reason.
5. **Backlog**: all `new` items (≤7 days), best score first. Near-identical titles are **clustered**.
6. **Analyze** up to `DISCOVERY_MAX_ITEMS_PER_RUN` clusters (concurrency 2, 45 s time budget).
   Auth or exhausted rate-limit errors halt analysis; remaining items stay queued.
7. **Merge or create** (serialised with a mutex so parallel analyses see each other):
   same/similar event key within 45 days, or ≥ 0.72 question similarity → attach as evidence, revalidate,
   flag conflicts (and send an *approved* candidate back to review). Otherwise create a candidate with
   its validation report, link sources, write audit events.
8. Progress is streamed to the browser as NDJSON; the run record keeps stats and a log.

## LLM usage (`src/server/llm`)

- OpenAI-compatible Groq endpoint via `fetch` (no SDK), `response_format: json_object`, temperature 0.2.
- Prompt encodes OmniMarketX market rules: suitability, question style, banned vague words, date semantics
  (close ≤ event), resolution with postponement handling, event key, per-article facts, ambiguity notes.
- Output → zod schema (lenient where harmless: `"Yes"` strings → outcome objects, 0–100 confidence → 0–1;
  strict where it matters: `suitable` must be boolean). One repair round-trip with the exact schema errors.
- Retry + fallback model on 429/5xx/timeouts; no retries on 401.
- The raw draft is stored on the item (`analysis`) and shown in the UI for auditing wrong AI output.

## Review & creation (`src/server/workflow`)

- Optimistic locking: every mutation passes `expectedVersion`; `UPDATE … WHERE version = $n`.
- Edits produce a revision diff; editing an approved candidate returns it to `pending_review`.
- Approval re-validates at decision time; blockers → 422; warnings require `acknowledgeWarnings`
  (recorded in the audit event).
- Market creation calls the publisher with `Idempotency-Key = candidate:<id>`, then records the market and
  status change in one transaction. Double clicks or retries after partial failure return the same market.

## Security

- Reviewer sign-in with a shared access code (constant-time compare, slowed failures), HMAC-signed httpOnly
  `SameSite=Lax` cookie (Web Crypto), 12 h expiry. `proxy.ts` redirects pages; every API route verifies again.
- Mutations reject cross-origin `Origin` headers (CSRF defence in depth).
- zod validation on every input; parameterised SQL only; request bodies capped at 100 KB.
- Only `http(s)` resolution URLs accepted from the LLM; external links open with `rel="noopener noreferrer"`.
- Security headers (`nosniff`, `DENY` framing, referrer policy); `robots: noindex`.
- Mock OMX API requires `x-api-key`. Cron endpoint requires `CRON_SECRET`.
- Not done (would be next): per-user accounts/roles (SSO), rate limiting per user, CSP with nonces.

## Observability

Structured JSON logs (`src/server/logger.ts`) with request ids for API calls, discovery lifecycle, source
failures, LLM retries and market creation. Discovery runs, source health and the audit log are also visible
in the UI — the signal inspector explains the fate of every ingested item.

## What I would build next

- Embedding-based similarity (pgvector) and cross-lingual dedupe; full-article extraction.
- Resolution monitoring: watch the resolution source after the event and propose the outcome.
- Per-user accounts with roles (analyst vs. approver, two-person rule for high-stakes markets).
- Background queue (e.g. Vercel Queues / Inngest) instead of request-scoped runs; per-source schedules.
- Feedback loop: use approve/reject reasons to tune the prompt and prefilter; evaluation set for the analyzer.
