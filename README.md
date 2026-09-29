# Market Foundry — OmniMarketX Market Discovery & Creation System

An internal tool that turns public information into **reviewable prediction-market candidates** and,
after explicit human approval, into structured OmniMarketX markets.

```
Public sources ──► Discover ──► Analyze ──► Structure ──► Validate ──► Human review ──► Create market
 (RSS / fixtures)   fetch +      Groq LLM     typed        rule engine   edit / approve    mock OMX API
                    dedupe +     (or rule-    candidate    + score       / reject          (idempotent)
                    prefilter    based)       + merge
```

**Automation never publishes.** Every candidate starts in `pending_review`; only a signed-in reviewer
can approve it, and market creation is a separate, explicit, idempotent action.

---

## Highlights

- **Real sources out of the box** — Federal Reserve, ECB, NASA, BBC (Business/Tech/Sport), NPR Politics,
  plus a deterministic synthetic "Demo Wire" feed and a deliberately broken feed to demonstrate failure isolation.
  Sources are configurable in the UI (add / toggle / dry-run test).
- **Groq free tier** (`llama-3.3-70b-versatile`, fallback `llama-3.1-8b-instant`) with JSON mode, zod schema
  validation, a repair round-trip, rate-limit fallback and a clearly labelled rule-based analyzer when no key is set.
- **Duplicate handling at four levels** — canonical-URL hashing, in-run story clustering, merging new
  evidence into an existing candidate (with conflicting-date detection), and similarity blocking against live markets.
- **Validation engine** — 25+ deterministic rules (subjective wording, date logic, resolution source trust,
  edge-case handling, evidence strength, conflicts, duplicates, analyzer uncertainty) → blockers / warnings / notes
  and a 0–100 triage score. The same pure function runs in the browser for **live feedback while editing**.
- **Review workflow** — state machine, optimistic locking, revision diffs, full audit log, warning acknowledgement.
- **Market creation boundary** — `MarketPublisher` interface → mock OmniMarketX API (`POST /api/mock-omx/v1/markets`)
  with API key + `Idempotency-Key`; payload carries full provenance of every source.
- **Polished console UI** — dashboard funnel, live streamed discovery log, signal inspector (why every item was
  skipped/merged/failed), review queue, candidate workspace, markets, sources, in-app "How it works".

## Quick start (local)

Requirements: Node.js 20+ (tested on 24), npm.

```bash
npm install
cp .env.example .env.local        # optional — everything has a working default
# (optional) put your Groq key in .env.local: GROQ_API_KEY=gsk_...
npm run dev
```

Open http://localhost:3000, sign in with any name and access code **`omx-review`** (shown on the login page),
then press **Run discovery**.

No database setup is needed: without `DATABASE_URL` the app boots **PGlite** (real PostgreSQL compiled to
WASM) and stores data in `.data/pglite`. Delete that folder to reset. Schema migrations and seed data are applied
automatically on first request.

Without `GROQ_API_KEY` the system uses the rule-based analyzer (candidates are marked `heuristic` and get lower
confidence). Get a free key at https://console.groq.com/keys for LLM-quality drafts.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on :3000 |
| `npm run build` / `npm start` | Production build / server |
| `npm test` | Vitest unit + integration tests (in-memory Postgres, no network) |
| `npm run test:e2e` | Builds, starts a production server on :3200 and runs Playwright browser tests |
| `npm run typecheck` / `npm run lint` | TypeScript / ESLint |
| `npm run check` | typecheck + lint + tests |

First e2e run: `npx playwright install chromium`.

## Deploying to Vercel

1. Import the repository in Vercel (framework preset: Next.js, no build overrides needed).
2. Add a Postgres database: **Storage → Create → Neon (free)**. It injects `DATABASE_URL` automatically.
3. Set environment variables: `GROQ_API_KEY`, `REVIEWER_ACCESS_CODE`, `SESSION_SECRET` (long random string),
   optionally `CRON_SECRET` (enables the daily scheduled discovery in `vercel.json`).
4. Deploy. Tables and seed data are created on the first request.

Without `DATABASE_URL` the deployment still works using in-memory PGlite, but data is per-instance and resets on
cold starts — fine for a quick look, not for a shared demo. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Documentation

| Doc | Contents |
|---|---|
| [understanding.md](understanding.md) | **Start here:** the whole project explained, following one article end to end |
| [demo.md](demo.md) | Click-by-click demo script, with expected results and failure cases |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components, request flows, key decisions and trade-offs |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | Tables, relationships, status machine, dedupe & provenance |
| [docs/API.md](docs/API.md) | REST endpoints, streaming protocol, mock OmniMarketX API contract |
| [docs/VALIDATION.md](docs/VALIDATION.md) | Every validation rule, the scoring formula and its limitations |
| [docs/TESTING.md](docs/TESTING.md) | Test strategy, what is covered, how to run |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Vercel + Neon setup, env vars, operations |
| [docs/WALKTHROUGH.md](docs/WALKTHROUGH.md) | Suggested demo script for the video |

## Tech stack

Next.js 16 (App Router, route handlers, proxy) · React 19 · TypeScript · Tailwind CSS v4 · SWR · zod 4 ·
PostgreSQL (`pg`) / PGlite · fast-xml-parser · Groq API · Vitest · Playwright · lucide-react · sonner.

## Project structure

```
src/
  app/
    (console)/            UI pages: dashboard, discovery, candidates, markets, sources, guide
    login/                reviewer sign-in
    api/                  REST route handlers (thin: parse → service → JSON)
  components/             UI primitives + feature components
  lib/                    code shared by browser and server
    domain.ts             types + zod input schemas + market payload contract
    validation.ts         rule engine (pure)
    similarity.ts         duplicate detection (pure)
  server/
    config.ts logger.ts   env + structured JSON logs
    db/                   pg | PGlite adapter, migrations, seed
    repositories/         SQL data access
    sources/              RSS/Atom parsing, fetching, fixtures
    discovery/            prefilter signals + pipeline orchestration
    llm/                  Groq client/analyzer, prompts, heuristic analyzer
    workflow/             review state machine, validation context, market creation
    markets/              publisher boundary + mock OmniMarketX API
    auth/ http/           sessions, API wrapper, errors
  proxy.ts                redirects unauthenticated page requests to /login
tests/  unit/ integration/ e2e/
docs/
```

## Existing code, libraries and AI tools

Started from `create-next-app` (Next.js 16 template). No other templates. Libraries are listed above.
The project was built with the help of an AI coding assistant (Claude Code) for scaffolding, implementation and
test writing; architecture, rules and trade-offs are documented in `docs/` so they can be reviewed independently.
