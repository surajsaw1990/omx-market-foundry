# API

All endpoints are JSON route handlers under `/api`. Unless noted, they require a reviewer session cookie
(`omx_session`, obtained from `POST /api/auth/login`). Mutations from browsers must be same-origin.

**Errors** always look like:
```json
{ "error": { "code": "VERSION_CONFLICT", "message": "Human readable", "details": {} } }
```
Common codes: `UNAUTHENTICATED` 401 · `CROSS_ORIGIN` 403 · `NOT_FOUND` 404 · `VERSION_CONFLICT` /
`INVALID_TRANSITION` / `RUN_IN_PROGRESS` / `NOT_APPROVED` / `LOCKED` 409 · `VALIDATION_FAILED` /
`BLOCKING_ISSUES` / `WARNINGS_NOT_ACKNOWLEDGED` / `INVALID_MARKET` 422 · `COOLDOWN` 429 · `INTERNAL` 500.
Every response carries `x-request-id`, which also appears in server logs.

## Auth

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/api/auth/login` | `{ name, code }` | Sets the session cookie. Public. |
| POST | `/api/auth/logout` | – | Clears the cookie. |
| GET | `/api/auth/me` | – | `{ user, demoAccessCode }`. Public. |
| GET | `/api/health` | – | DB kind + latency, analyzer, publisher. Public. |

## Discovery

| Method | Path | Notes |
|---|---|---|
| POST | `/api/discovery/run` | Starts a run. Response is **NDJSON** (`application/x-ndjson`), one event per line (below). Pre-start errors (`COOLDOWN`, `RUN_IN_PROGRESS`) are normal JSON errors. |
| GET | `/api/discovery/runs` | Last 30 runs. |
| GET | `/api/discovery/runs/:id` | `{ run, items }` — the items ingested in that run with status + reason. |
| GET | `/api/items?status=&runId=` | Source items. |
| POST | `/api/items/:id/requeue` | Put a `failed` / `unsuitable` / `skipped` item back in the queue. |
| GET | `/api/cron/discover` | Scheduled run. Requires `Authorization: Bearer $CRON_SECRET`. |

Stream events:
```jsonc
{"type":"run_started","runId":"run_…","analyzer":"groq","sources":9}
{"type":"source","sourceId":"src_…","name":"BBC Sport","ok":true,"fetched":25,"fresh":3}
{"type":"source","name":"Legacy wire feed","ok":false,"fetched":0,"fresh":0,"error":"network: … ENOTFOUND"}
{"type":"item","itemId":"itm_…","title":"…","status":"analyzing|unsuitable|failed","reason":"…"}
{"type":"candidate","candidateId":"cand_…","question":"…","score":82,"merged":false}
{"type":"log","level":"info|warn|error","message":"…"}
{"type":"run_finished","runId":"run_…","status":"completed_with_errors","stats":{…}}
```

## Candidates

| Method | Path | Body |
|---|---|---|
| GET | `/api/candidates?status=&category=&q=&sort=score\|newest\|closing` | – → `{ candidates, counts }` |
| GET | `/api/candidates/:id` | – → `{ candidate, sources, similar, revisions, activity, market, analyses }` (validation recomputed) |
| PATCH | `/api/candidates/:id` | `{ expectedVersion, changes: Partial<CandidateEditInput> }` |
| POST | `/api/candidates/:id/approve` | `{ expectedVersion, note?, acknowledgeWarnings? }` |
| POST | `/api/candidates/:id/reject` | `{ expectedVersion, reason }` |
| POST | `/api/candidates/:id/reopen` | `{ expectedVersion }` |
| POST | `/api/candidates/:id/market` | – → `201 { market }` created, `200 { market, replay: true }` if it already existed |

`CandidateEditInput` (see `src/lib/domain.ts`): `question`, `category`, `description`, `outcomeType`
(`binary`/`multiple`), `outcomes[{label}]`, `eventDate`, `closeDate` (ISO), `resolutionCriteria`,
`resolutionSourceName`, `resolutionSourceUrl`, `tags[]`.

## Markets & sources

| Method | Path | Notes |
|---|---|---|
| GET | `/api/markets`, `/api/markets/:id` | Created + seed markets, with payload and lifecycle |
| GET / POST | `/api/sources` | POST `{ name, url, reliability, categoryHint? }` adds an RSS/Atom source |
| PATCH / DELETE | `/api/sources/:id` | `{ enabled?, name?, reliability?, categoryHint? }` |
| POST | `/api/sources/:id/test` | Dry-run fetch + prefilter scores; stores nothing |
| GET | `/api/overview` | Dashboard aggregates |

## Mock OmniMarketX Market API

The service boundary for market creation (`src/server/markets`). Public (no session) but keyed.

```
POST /api/mock-omx/v1/markets
x-api-key: <OMX_API_KEY>            (default "mock-omx-key")
Idempotency-Key: candidate:<id>     (required, 8–200 chars)
Content-Type: application/json
```
Body (`omxMarketPayloadSchema`):
```json
{
  "title": "Will the European Parliament adopt … on October 19, 2026?",
  "slug": "will-the-european-parliament-adopt-…",
  "description": "…",
  "category": "Politics",
  "marketType": "binary",
  "outcomes": [{ "id": "yes", "label": "Yes" }, { "id": "no", "label": "No" }],
  "closesAt": "2026-10-19T00:00:00.000Z",
  "expectedResolutionAt": "2026-10-19T18:00:00.000Z",
  "resolution": { "criteria": "Resolves YES if …", "source": { "name": "European Parliament", "url": "https://www.europarl.europa.eu/…" } },
  "tags": ["politics"],
  "provenance": {
    "candidateId": "cand_…", "candidateVersion": 3, "generator": "groq:llama-3.3-70b-versatile@…",
    "approvedBy": "Priya", "approvedAt": "…",
    "sources": [{ "title": "…", "url": "https://…", "publisher": "BBC News — Business", "publishedAt": "…" }]
  }
}
```
Responses: `201 { market: { id, url, status: "scheduled", slug, createdAt, idempotentReplay: false } }`,
`200` same market with `idempotentReplay: true` for a repeated key, `401` bad key, `400` missing key,
`422` invalid payload (`closesAt` in the past, close after resolution, schema errors), `503` simulated outage
(`MOCK_OMX_FAILURE_RATE`). `GET /api/mock-omx/v1/markets/:id` returns a stored market.

Set `OMX_API_URL=https://<host>/api/mock-omx` to make the app call this contract over real HTTP
(`HttpOmxPublisher`) instead of in-process.
