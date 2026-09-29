# Understanding the project — Market Foundry

This document explains the **whole project from zero**: what problem it solves, how the pieces fit together, what
happens to a single news article step by step, where each piece of code lives, and why it was built this way.
Read it top to bottom once and you should be able to explain or change any part of the system.

---

## 1. The problem in one paragraph

OmniMarketX is a prediction-market platform. Someone has to keep finding events people could bet on ("Will the Fed
cut rates on Oct 28?") and turn them into **well-defined markets**: a clear question, fixed outcomes, a closing time, and
an objective way to decide the result. Doing that by hand is slow, and doing it carelessly produces bad markets
(ambiguous, unverifiable, duplicated). This project is an **internal tool** that reads public news, drafts market
candidates automatically, checks them for quality problems, and gives a **human reviewer** a workspace to fix, approve or
reject them. Only then can a market be created. **The machine drafts; the human decides.**

```
Public sources → Discover → Analyze → Structure → Validate → Human review → Create market
```

---

## 2. The big picture

```
                         ┌──────────────────────────────┐
  RSS feeds (BBC, Fed,   │        DISCOVERY PIPELINE     │
  ECB, NASA, NPR) ──────►│ fetch → dedupe → prefilter → │
  + Demo Wire fixtures   │ cluster → analyze (Groq LLM) │
                         │ → merge or create candidate  │
                         └──────────────┬───────────────┘
                                        │ candidates (status: pending_review)
                                        ▼
                         ┌──────────────────────────────┐
                         │      VALIDATION ENGINE        │  25+ rules → blockers / warnings / notes
                         │   (runs on server + browser)  │  + quality score 0–100
                         └──────────────┬───────────────┘
                                        ▼
                         ┌──────────────────────────────┐
                         │   HUMAN REVIEW (the web UI)   │  edit · approve · reject · reopen
                         └──────────────┬───────────────┘
                                        │ approved
                                        ▼
                         ┌──────────────────────────────┐
                         │  MARKET PUBLISHER (boundary)  │ ──► Mock OmniMarketX API
                         └──────────────────────────────┘      (idempotent, keyed)
```

Everything is **one Next.js application**:
- the **web UI** (React pages the reviewer uses),
- the **backend API** (route handlers under `/api/...`),
- the **business logic** (plain TypeScript in `src/server/`),
- the **database**: PostgreSQL. It's real Postgres on Vercel/Neon, or **PGlite** (Postgres compiled to WebAssembly,
  running inside Node) locally, so no database install is needed.

---

## 3. Following one article through the system

This is the most useful way to understand the code. Take a real-looking headline:

> **"European Parliament to hold final plenary vote on AI Liability Directive on October 19, 2026"**

### Step 1 — Fetch (`src/server/sources/`)
- `fetcher.ts → fetchSourceItems()` downloads the feed with an 8-second timeout and one retry for temporary errors
  (timeouts, 5xx). DNS failures and 4xx are not retried.
- `rss.ts → parseFeed()` converts RSS/Atom/RDF XML into simple objects `{url, title, summary, publishedAt}`. It
  handles messy real-world feeds: BOM characters, CDATA, HTML inside descriptions, relative links, single-item feeds.
- For the demo feed, `fixtures.ts → fixtureItems()` generates synthetic articles with dates **relative to today**.

### Step 2 — De-duplicate and store (`src/server/repositories/others.ts → insertItemIfNew`)
- The URL is **canonicalised**: lowercase host, `www.` removed, `utm_*` tracking parameters removed, trailing slash
  removed, query sorted. Then it's hashed (SHA-256) into `url_hash`.
- `INSERT … ON CONFLICT (url_hash) DO NOTHING`: if we've seen this article before, nothing happens. This is why
  running discovery twice doesn't produce duplicates.

### Step 3 — Prefilter (`src/server/discovery/signals.ts → prefilterScore`)
A cheap score from 0 to 1 that answers "could this possibly be a market?", **without calling the LLM**:

| Signal | Points |
|---|---|
| Mentions an upcoming date ("October 19, 2026") | +0.40 |
| Forward-looking language ("to hold", "expected to", "scheduled") | +0.25 |
| Event words (vote, decision, launch, final, IPO…) | up to +0.25 |
| Numbers / money / percentages | +0.10 |
| Headline looks like opinion / gallery / live blog | score forced to 0.05 |

Below **0.3**, the article is marked `skipped` and the reason is stored. Our example scores about 0.9, so it's queued for analysis.

### Step 4 — Cluster (`pipeline.ts`)
If two feeds carry the same story in the same run (title similarity ≥ 0.55), it's analysed **once**. The other copies are
linked as supporting sources.

### Step 5 — Analyze (`src/server/llm/`)
- `groq.ts → GroqAnalyzer.analyze()` sends the article to Groq (model `llama-3.3-70b-versatile`) with the prompt
  from `prompts.ts`. The prompt explains OmniMarketX's rules: what counts as suitable, how to phrase the question,
  banned vague words, how to set dates (the market closes **before** the event), how to write resolution criteria
  (including what happens if the event is postponed), and to report ambiguities instead of inventing facts.
- The model returns JSON like:
  ```json
  {
    "suitable": true,
    "question": "Will the European Parliament adopt the AI Liability Directive in its plenary vote on October 19, 2026?",
    "category": "Politics",
    "outcomeType": "binary", "outcomes": [{"label":"Yes"},{"label":"No"}],
    "eventDate": "2026-10-19T16:00:00Z", "closeDate": "2026-10-18T23:59:00Z",
    "resolutionCriteria": "Resolves YES if … If the vote is postponed beyond …, resolves NO.",
    "resolutionSourceName": "European Parliament", "resolutionSourceUrl": "https://www.europarl.europa.eu/…",
    "eventKey": "eu-parliament-ai-liability-vote-2026-10",
    "facts": {"eventDate": "2026-10-19", "keyClaims": ["…"]},
    "ambiguityNotes": ["Some groups may request a postponement"],
    "confidence": 0.78
  }
  ```
- The JSON is checked against a **zod schema** (`llm/types.ts → analysisDraftSchema`). If it's invalid, the exact
  errors are sent back to the model **once** for a repair. If that fails too, the article is marked `failed` (retryable).
- If Groq is rate-limited (HTTP 429) or down, the call retries once and then switches to the fallback model
  `llama-3.1-8b-instant`.
- **No API key?** `heuristic.ts → HeuristicAnalyzer` builds a question from headline patterns ("X to do Y on DATE" becomes
  "Will X do Y by DATE?"). It's labelled `heuristic` and gets low confidence so reviewers know.

### Step 6 — Merge or create (`pipeline.ts → findMergeTarget`)
Before creating anything, the system asks: **is there already a candidate for this event?**
- Same or very similar `eventKey` (word overlap ≥ 60% once dates are ignored) **and** event dates within 45 days, **or**
- question similarity ≥ 0.72

→ **Merge**: attach the article to the existing candidate as extra evidence, re-validate it, and check whether the new article
reports a **different date** (a conflict). If the candidate was already approved and a conflict appears, it's sent **back to
review** automatically.

→ **Otherwise create** a new candidate (status `pending_review`), link the article as its `primary` source, and write
an audit event. This happens inside a database transaction.

### Step 7 — Validate (`src/lib/validation.ts → validateCandidate`)
The candidate goes through deterministic rules (full list in `docs/VALIDATION.md`), for example:
- 🛑 **blocker**: subjective words ("best", "successful"), market closes after the event, no resolution source,
  duplicate of a live market, date in the past, criteria too thin
- ⚠️ **warning**: vague words ("significant", "soon"), no date in the question, no postponement handling,
  untrusted resolution domain, sources disagree on the date, only one weak source, low AI confidence
- ℹ️ **info**: minor things (no time zone, thin description…)

**Score = 100 − 25×blockers − 8×warnings − 2×notes.** It's used to sort the review queue.

### Step 8 — Human review (the UI + `src/server/workflow/review.ts`)
The reviewer opens the candidate, reads the sources, fixes the wording or dates (the checks update **live while typing**),
then:
- **Approve** is possible only with **0 blockers**, and warnings must be ticked as "reviewed".
- **Reject** requires a reason.
Every change increments a `version` number and stores a **diff** (revision) plus an **audit event** naming who did it.

### Step 9 — Create the market (`src/server/workflow/createMarket.ts`)
- Only `approved` candidates. Validation runs once more, since dates may have passed in the meantime.
- A **market payload** is built, including `provenance`: every source article's title, URL and publisher.
- The payload goes to the **publisher** (`src/server/markets/publisher.ts`), which calls the **mock OmniMarketX API**
  (`mockOmx.ts`) with `Idempotency-Key: candidate:<id>`. Calling it twice returns the same market, never two.
- The market is saved locally and the candidate becomes `market_created` (final, read-only).

**End result:** a market whose payload still contains the original article URL. That's proven by an automated test.

---

## 4. Folder map — what every part does

```
omx-market-foundry/
├── src/
│   ├── app/                         ← Next.js App Router (pages + API)
│   │   ├── layout.tsx               root HTML, fonts, toast container
│   │   ├── globals.css              design tokens (colours, animations), Tailwind v4
│   │   ├── login/page.tsx           reviewer sign-in screen
│   │   ├── (console)/               all signed-in pages (share the sidebar layout)
│   │   │   ├── layout.tsx           wraps pages in ConsoleShell (sidebar)
│   │   │   ├── page.tsx             Dashboard (funnel, needs-review, source health, runs, activity)
│   │   │   ├── discovery/page.tsx   Run discovery + run history + signal inspector
│   │   │   ├── candidates/page.tsx  Review queue (tabs, search, filters)
│   │   │   ├── candidates/[id]/     Candidate workspace (edit/approve/reject/create market)
│   │   │   ├── markets/             Market list + market detail (payload, provenance)
│   │   │   ├── sources/page.tsx     Manage sources (toggle, add, test, delete)
│   │   │   └── guide/page.tsx       In-app "How it works"
│   │   └── api/                     REST endpoints (thin: validate input → call service → JSON)
│   │       ├── auth/                login, logout, me
│   │       ├── discovery/           run (streaming), runs, runs/[id]
│   │       ├── candidates/          list, detail, PATCH edit, approve, reject, reopen, market
│   │       ├── items/, markets/, sources/, overview/, health/
│   │       ├── mock-omx/v1/markets  the fake OmniMarketX market service
│   │       └── cron/discover        scheduled run (Vercel Cron)
│   │
│   ├── components/                  ← React UI building blocks
│   │   ├── ui.tsx                   Button, Badge, Card, Input, Modal, ScoreRing, Tabs, …
│   │   ├── shell.tsx                sidebar + mobile menu
│   │   ├── discovery-runner.tsx     reads the streaming run and renders the live log
│   │   ├── activity.tsx             audit timeline
│   │   └── candidate/               definition view/editor, validation panel, sources panel
│   │
│   ├── lib/                         ← shared by browser AND server (no Node-only code)
│   │   ├── domain.ts                all types + zod input schemas + market payload contract
│   │   ├── validation.ts            the rule engine (pure function)
│   │   ├── similarity.ts            text similarity for duplicates (pure function)
│   │   ├── client.ts                browser fetch helper (errors, 401 → login)
│   │   ├── format.ts                dates, relative time, class names
│   │   └── api-types.ts             response shapes used by pages
│   │
│   ├── server/                      ← backend logic (only runs on the server)
│   │   ├── config.ts                reads environment variables with defaults
│   │   ├── logger.ts                JSON logs
│   │   ├── ids.ts                   id generation (cand_…, itm_…), sha256
│   │   ├── db/client.ts             Postgres or PGlite adapter (same interface)
│   │   ├── db/schema.ts             SQL migrations (the whole schema)
│   │   ├── db/seed.ts               default sources + 3 "already live" markets
│   │   ├── repositories/            all SQL queries (candidates.ts, others.ts, mappers.ts)
│   │   ├── sources/                 RSS parser, fetcher, fixture articles
│   │   ├── discovery/               signals.ts (prefilter, dates), pipeline.ts (orchestration)
│   │   ├── llm/                     groq.ts, prompts.ts, heuristic.ts, types.ts
│   │   ├── workflow/                review.ts (state machine), context.ts, createMarket.ts
│   │   ├── markets/                 publisher.ts (interface), mockOmx.ts (fake service)
│   │   ├── auth/session.ts          signed cookie sessions
│   │   └── http/                    handler.ts (API wrapper), errors.ts (AppError)
│   │
│   └── proxy.ts                     redirects signed-out users to /login (Next 16's "middleware")
│
├── tests/
│   ├── unit/                        validation, text/similarity/RSS, LLM + sessions
│   ├── integration/                 full backend workflow on an in-memory Postgres
│   ├── e2e/                         Playwright browser tests
│   └── helpers.ts                   fresh DB, fake fetch
├── docs/                            architecture, data model, API, validation, testing, deployment, walkthrough
├── demo.md                          click-by-click demo guide
├── understanding.md                 this file
├── .env.example                     every setting, documented
└── vercel.json                      daily cron job
```

### The layering rule
```
UI page  →  API route (src/app/api)  →  service (src/server/workflow | discovery)  →  repository (SQL)  →  DB
                                            ↘ shared pure logic (src/lib/validation, similarity)
```
Routes are thin, business rules live in services, and SQL lives only in repositories. That's why the integration tests can
exercise the whole workflow **without HTTP**.

---

## 5. The database

Nine tables (full detail in `docs/DATA_MODEL.md`):

| Table | Holds | Key detail |
|---|---|---|
| `sources` | configured feeds | reliability tier (official / major_media / …), health (last error, failure count) |
| `discovery_runs` | each run | stats + log; a partial unique index allows only **one running run** |
| `source_items` | every article ever ingested | `url_hash` UNIQUE (dedupe); `status` says what happened; `analysis` keeps raw AI JSON |
| `candidates` | market proposals | `version` (locking), `status`, `validation` report, `event_key` |
| `candidate_sources` | links articles ↔ candidates | `role` (primary/supporting) and `facts` (what *this* article claims, e.g. the date) |
| `candidate_revisions` | edit history | `{field: {from, to}}` diffs |
| `audit_events` | who did what, when | actor = reviewer name or `system:discovery` |
| `markets` | created markets | `candidate_id` UNIQUE, full payload with provenance |
| `omx_markets` | the mock external service's storage | `idempotency_key` UNIQUE |

### Candidate status machine
```
pending_review ──approve──► approved ──create market──► market_created   (final)
      ▲    │                  │  │
      │    └──reject──►  rejected ◄──reject─┘
      │                     │
      └────── reopen ───────┘      (also: editing an approved candidate, or new conflicting
                                    evidence, sends it back to pending_review)
```

### Item statuses (what happened to each article)
`new` (queued) · `skipped` (prefilter) · `unsuitable` (AI said no) · `candidate` (created one) · `merged` (added as
evidence) · `clustered` (same story in one run) · `failed` (analysis error, can be re-queued).

---

## 6. Key concepts explained simply

**Event key.** A short slug naming the *underlying real-world event*, independent of wording:
`spacex-starship-flight-test-2026-10`. Two differently worded articles about the same launch get the same or a similar
key, and that's how they're merged.

**Similarity.** `similarity.ts` compares two questions using shared words (after removing filler words like "the/will") plus
shared 3-letter chunks. If both questions have dates more than 21 days apart, the score is cut, because "BTC above 150k in
October" and "…in December" are *different* markets.

**Optimistic locking.** Every candidate has a `version`. Every save says "I'm editing version 3". The SQL is
`UPDATE … WHERE id = $1 AND version = 3`. If someone else already saved version 4, nothing is updated and the user
sees "changed by someone else — reload". No lost edits, no locks held.

**Idempotency.** Creating a market sends `Idempotency-Key: candidate:<id>`. The mock service stores that key with a UNIQUE
constraint, so a second call with the same key returns the first market. Double clicks, retries and network glitches are all safe.

**Provenance.** The market payload includes the list of source articles (title, URL, publisher, date) plus who approved it
and which AI model drafted it. Anyone can trace a market back to its evidence.

**Streaming progress.** `POST /api/discovery/run` doesn't wait until the end. It sends one JSON line per event
(NDJSON) while the run progresses, and `discovery-runner.tsx` reads the stream and renders the live log.

**Shared validation.** `src/lib/validation.ts` has no server-only imports, so the browser imports it too. That's how
the edit form shows warnings instantly. The server always re-runs it and has the final say.

---

## 7. Security in plain words

- **Sign-in**: name + shared access code (`REVIEWER_ACCESS_CODE`, default `omx-review`). The code is compared in constant
  time, and wrong attempts are slowed down.
- **Session**: a cookie containing `{name, role, expiry}` plus an HMAC signature (`SESSION_SECRET`). It can't be forged or
  edited, it's httpOnly (JavaScript can't read it), and it expires after 12 hours.
- **Two layers of checks**: `proxy.ts` redirects signed-out page visits, and **every API route** verifies the session again.
- **CSRF**: changes are rejected if the request comes from another website (the `Origin` header is checked).
- **Input**: every request body is validated with zod, and SQL always uses parameters (`$1`, `$2`), never string concatenation.
- **AI output is untrusted**: only `http(s)` URLs are accepted, and everything goes through validation and human approval.
- The mock market API requires `x-api-key`, and the cron endpoint requires `CRON_SECRET`.

---

## 8. Failure handling — what happens when things break

| Failure | What the system does |
|---|---|
| A feed is down / DNS fails / times out | That source is marked unhealthy (red dot, error text, failure count); the other sources continue; run status `completed_with_errors` |
| Feed returns HTML or broken XML | Typed parse error, same isolation as above |
| LLM returns invalid JSON | One repair attempt with the exact errors; then the item is `failed` with a reason and a **Re-queue** button |
| LLM rate limit (429) | Retry once, then switch to the fallback model; if all are exhausted, stop analysing and keep the remaining items queued |
| Wrong API key (401) | Stop analysing immediately (no pointless retries) |
| Run killed mid-way (serverless timeout) | Stale "running" runs are expired after 10 minutes so they don't block new runs |
| Two runs started at once | The database unique index lets only one exist; the other gets 409 |
| Two reviewers edit at once | Version conflict (409) for the second; the UI offers "Reload" |
| Create market clicked twice / retried after a crash | Idempotency key returns the same market |
| Market API down | Error shown, audit event `market_creation_failed`, candidate stays `approved`, safe to retry |
| Candidate's close date passes after approval | Re-validation at creation time blocks it (`CLOSE_IN_PAST`) |

---

## 9. Configuration

Everything is optional, with safe defaults (see `.env.example`):

| Variable | Default | Effect |
|---|---|---|
| `GROQ_API_KEY` | – | enables the LLM analyzer (otherwise heuristic) |
| `GROQ_MODEL` / `GROQ_FALLBACK_MODEL` | llama-3.3-70b-versatile / llama-3.1-8b-instant | models |
| `DATABASE_URL` | – | real Postgres; without it, PGlite in `.data/pglite` |
| `REVIEWER_ACCESS_CODE` / `SESSION_SECRET` | `omx-review` / derived | auth |
| `DISCOVERY_MAX_ITEMS_PER_RUN` | 8 | LLM calls per run (free-tier budget) |
| `DISCOVERY_COOLDOWN_SECONDS` | 20 | minimum gap between runs |
| `OMX_API_URL` | – | call the market API over HTTP instead of in-process |
| `CRON_SECRET` | – | enables the scheduled daily run |

---

## 10. Tests — what proves it works

| Suite | Count | Proves |
|---|---|---|
| `tests/unit` | 30+ | each validation rule, similarity, date parsing, RSS/Atom parsing, URL canonicalisation, Groq retries/fallback/repair, heuristic analyzer, session tampering |
| `tests/integration` | 13 | whole backend on real Postgres semantics: dedupe across runs, merge + conflict, duplicate blocking, broken source isolation, LLM failure + re-queue, optimistic locking, approval rules, **exactly one market under concurrent creation**, **source URL survives into the market** |
| `tests/e2e` | 4 | a real browser clicking through login → discovery → edit (live validation) → approve → create market → provenance, plus reject and the signal inspector |

Run with `npm test` and `npm run test:e2e`.

---

## 11. Why it's built this way (the decisions)

| Decision | Reason | Trade-off |
|---|---|---|
| One Next.js app | single deploy on Vercel; UI and API share types and validation code | not a separate microservice backend |
| PGlite locally, Postgres in production | zero setup, and tests run the **same SQL** as production | PGlite on Vercel without Neon is not persistent |
| Raw SQL, no ORM | schema is explicit and easy to document and review | more hand-written mapping code |
| Cheap prefilter before the LLM | saves free-tier quota and makes skip decisions explainable | may miss oddly worded but valid events (they can be re-queued) |
| LLM + deterministic rules | LLM for language understanding; rules for guarantees it can't give | rules are English word lists and lexical |
| Merge instead of duplicate | one candidate per event, with growing evidence and conflict detection | lexical matching can miss paraphrases |
| Separate approve and create steps | the human decision and the external side effect are distinct and auditable | one extra click |
| Mock market API behind an interface | real HTTP contract (keys, idempotency, validation) without production access | not connected to real OmniMarketX |

**Deliberately left out:** per-user accounts and roles, a background job queue, full-article scraping, embeddings-based
similarity, and automatic resolution of markets after the event. These are listed as next steps in `docs/ARCHITECTURE.md`.

---

## 12. Glossary

| Term | Meaning |
|---|---|
| **Signal / item** | one ingested article (`source_items` row) |
| **Candidate** | a drafted market waiting for or after human review |
| **Market** | the final structured market created through the market API |
| **Blocker / warning / note** | validation severities: can't approve / must acknowledge / informational |
| **Quality score** | 0–100 triage number derived from the issues |
| **Event date** | when the outcome becomes known |
| **Close date** | when trading stops (must be at or before the event date) |
| **Resolution criteria / source** | exact rule plus authoritative place used to decide the outcome |
| **Provenance** | the chain of source articles and approvals behind a market |
| **Fixture / Demo Wire** | bundled synthetic articles for deterministic demos and tests |
| **Heuristic analyzer** | rule-based fallback when no LLM key is configured |
| **NDJSON** | newline-delimited JSON, used to stream discovery progress |
| **Idempotency key** | an id that makes repeating the same request safe |

---

## 13. Quick answers to likely questions

- **"Can the system publish a market on its own?"** No. Every candidate starts as `pending_review`; approval requires a
  signed-in reviewer, and creating the market is a separate explicit action. Both are enforced on the server.
- **"How do you stop duplicates?"** At four levels: URL hash, in-run clustering, merging into existing candidates by event key or
  similarity, and blocking against live markets.
- **"What if the AI is wrong?"** Strict schema with one repair attempt, raw output kept for audit, deterministic validation on top,
  and a human approves. Low confidence and model-reported ambiguity become warnings.
- **"How do you know source info survives?"** `candidate_sources` links every article, the market payload's
  `provenance.sources` copies them, and an integration test asserts the original URL is present in the created market.
- **"How is ambiguity handled?"** The model lists doubts instead of guessing, each source's claimed date is stored separately
  to detect conflicts, and the reviewer resolves them with live validation feedback.
- **"What would you build next?"** Embeddings for similarity, resolution monitoring after events, roles with two-person
  approval, a background queue, and an evaluation set to measure analyzer quality.
