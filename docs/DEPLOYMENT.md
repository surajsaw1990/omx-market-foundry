# Deployment (Vercel)

## One-time setup

1. Push the repository to GitHub (or use `vercel` CLI from the project folder).
2. **Vercel → Add New → Project → Import**. Framework: Next.js. No build settings to change.
3. **Storage → Create Database → Neon (Postgres, free)** and connect it to the project. This sets
   `DATABASE_URL` (also accepted: `POSTGRES_URL`).
4. **Settings → Environment Variables**:

| Variable | Required | Example |
|---|---|---|
| `GROQ_API_KEY` | recommended | `gsk_…` from https://console.groq.com/keys |
| `REVIEWER_ACCESS_CODE` | yes | a code you give reviewers |
| `SESSION_SECRET` | yes | 32+ random characters |
| `SHOW_DEMO_ACCESS_CODE` | no | `true` for a public demo (shows the code on the login page), `false` otherwise |
| `CRON_SECRET` | no | enables the daily `/api/cron/discover` job from `vercel.json` |
| `GROQ_MODEL`, `GROQ_FALLBACK_MODEL` | no | override models |
| `OMX_API_URL`, `OMX_API_KEY` | no | call the market API over HTTP (e.g. `https://<app>/api/mock-omx`) |

5. Deploy. The first request runs migrations (advisory-locked) and seeds sources + demo markets.

## Runtime notes

- Discovery runs inside the request (`maxDuration = 60`), with a 45 s analysis budget and at most
  `DISCOVERY_MAX_ITEMS_PER_RUN` LLM calls. Unfinished items stay queued for the next run.
- Without `DATABASE_URL`, PGlite runs in memory on each serverless instance: the app works, but data is not
  shared between instances and disappears on cold start. Use Neon for anything you want to keep.
- Logs are single-line JSON (`event`, `requestId`, …) — searchable in Vercel's log viewer.
- Health check: `GET /api/health`.
- Reset a demo database: drop the tables in Neon (or delete `.data/` locally); they are recreated on boot.
