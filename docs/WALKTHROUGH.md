# Walkthrough video — suggested script (≈9–10 min)

## 1. Intro (0:30) — camera on
Name, relevant experience, one line: "I built Market Foundry, an internal tool that goes from public news to
reviewed, structured OmniMarketX markets — with a human approving every market."

## 2. What I built (2:00) — live demo
1. Login screen → note reviewer auth (name is recorded on every decision).
2. Dashboard funnel → **Run discovery**. Narrate the streamed log: sources fetched, the broken legacy feed failing
   without stopping the run, items analysed, a new candidate, "Evidence added" (merge).
3. Review queue → sorted by quality; point out blockers/warnings chips.
4. Open the **European Parliament** candidate: definition, supporting source (expand, open original), validation
   panel, analyzer output.
5. **Edit**: type a vague word ("significantly") → live warning appears; fix it; save → revision + re-validation.
6. **Approve** → warnings must be acknowledged → approved by *you*.
7. **Create market** → market page: payload sent to the mock OMX API, provenance sources, lifecycle.

## 3. Repository (1:00)
`src/app` (UI + thin API), `src/server` (pipeline, llm, workflow, repositories, markets boundary),
`src/lib` (shared domain + pure validation/similarity), `tests/`, `docs/`. Stack: Next.js 16, TypeScript,
Tailwind, Postgres/PGlite, Groq. Started from create-next-app; built with Claude Code as a pair programmer.

## 4. Data model (1:00)
Show `docs/DATA_MODEL.md` diagram: sources → items (unique URL hash) → candidate_sources (role + facts) →
candidates (version, status machine) → revisions/audit → markets (provenance snapshot). Explain 4 dedupe
levels and the provenance test.

## 5. Decisions (1:30)
Prioritised correctness & reviewability over volume; one deployable; PGlite for identical SQL; official feeds as
both signal and resolution source; bounded LLM calls; deterministic rules on top of the LLM.
Left out: per-user accounts/roles, background queue, full-article scraping, embeddings.
Next week: resolution monitoring, embeddings dedupe, role-based two-person approval, analyzer eval set.

## 6. The hard part (1:30) — include failure cases
- **Same event, conflicting reports**: Starship "Oct 8" vs "slips to Oct 15" → merged, conflict flagged
  (show two source cards with different reported dates). If it had been approved, it goes back to review.
- **Duplicate of a live market**: Bitcoin candidate blocked (Approve disabled) — show the Similar panel.
- **Failures**: Sources page → Test the legacy feed (ENOTFOUND, health red). Mention LLM invalid JSON →
  repair round-trip → otherwise item `failed` + Re-queue button (Discovery → signal inspector).
- **Incorrect AI output**: Analyzer output panel keeps the raw draft; validation catches close-after-event,
  subjective wording, untrusted resolution sources.

## 7. OmniMarketX feedback (0:45)
Keep it specific: the user problem, the suggestion, and the business impact (e.g. clearer resolution-source
display on market pages to build trust; showing "why this market exists" context from sources; alerts when a
market's underlying event date changes).
