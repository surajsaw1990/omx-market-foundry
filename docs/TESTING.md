# Testing

```bash
npm test            # Vitest: unit + integration (≈40 s, no network, no API keys)
npm run test:e2e    # production build + Playwright (Chromium) against next start on :3200
npm run check       # typecheck + lint + npm test
```
First e2e run: `npx playwright install chromium`.

## Unit (`tests/unit`)

- **validation.test.ts** — every rule family, scoring formula, ordering, rejected-candidate duplicates ignored,
  trusted-domain matching (incl. `bbci.co.uk.evil.com` spoof).
- **text.test.ts** — tokenizer/stemming, similarity + date penalty, merge-target selection (same event merges,
  different event doesn't), date extraction (4 formats, year roll-over), prefilter, RSS (CDATA, entities,
  relative links), Atom, malformed feeds, URL canonicalisation, draft normalisation (unsafe `javascript:` URL dropped).
- **llm.test.ts** — Groq analyzer with a stubbed `fetch`: valid JSON, schema-error repair round-trip,
  failure after two invalid outputs, 429 → fallback model, no retry on 401; heuristic analyzer patterns;
  session signing (tamper, wrong secret, expiry).

## Integration (`tests/integration/workflow.test.ts`)

Real PostgreSQL semantics via in-memory PGlite, fixture feed, stubbed network:

- discovery creates only `pending_review` candidates; opinion/gallery items are filtered;
- second report of the same event **merges** and flags **conflicting dates**;
- Bitcoin story is **blocked as a duplicate** of a seed market;
- a second run ingests **0 new items / 0 candidates** (URL dedupe);
- an unreachable source → `completed_with_errors`, health + failure count recorded, other sources processed;
- **LLM failure** → items `failed`, no candidates; re-queue → analysed next run;
- concurrent run refused (`RUN_IN_PROGRESS`, partial unique index);
- edit → revision diff; stale `expectedVersion` → `VERSION_CONFLICT`; invalid URL → `VALIDATION_FAILED`;
- approval blocked by blockers; requires warning acknowledgement; **two concurrent create-market calls produce
  exactly one market** (idempotency); **source URL survives into market provenance**; created candidates are locked;
- editing an approved candidate resets it to review; reject → reopen; invalid transitions refused;
- mock OMX API validates payloads and replays idempotency keys.

## End-to-end (`tests/e2e/workflow.spec.ts`)

Chromium against the production build with a fresh database:
anonymous redirect + wrong code → login → run discovery (streamed log shows merge) → queue → duplicate candidate
cannot be approved → merged candidate shows conflict + 2 sources → edit with **live** validation preview →
save → approve with warning acknowledgement → create market → market page shows payload + provenance →
unauthenticated API returns 401 → reject with reason → signal inspector shows filter reasons.

## Manual checks worth doing with a Groq key

1. Put `GROQ_API_KEY` in `.env.local`, enable a few real sources, run discovery.
2. Open the "Analyzer output" panel on a candidate to compare the raw draft with the stored candidate.
3. Set `GROQ_API_KEY=invalid` → run halts analysis with an auth error, items are `failed` and re-queueable.
