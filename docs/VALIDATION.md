# Validation & scoring

Source: `src/lib/validation.ts` (pure, shared by server and browser).

## How it works

`validateCandidate(input, context)` runs deterministic rules over the candidate plus context
(linked sources with reliability and reported facts, similar candidates/markets, analyzer notes and confidence)
and returns issues with a severity:

- **blocker** — the candidate cannot be approved (enforced server-side at approval and again at market creation);
- **warning** — the reviewer must explicitly acknowledge it when approving (recorded in the audit log);
- **info** — worth a look.

**Score** = `100 − 25 × blockers − 8 × warnings − 2 × notes`, clamped to 0–100. It orders the review
queue (best first) and colours the ring (≥75 green, ≥50 amber, else red).

The server recomputes the report on every edit, on approval, on market creation and whenever the detail page
is opened (dates pass, markets go live, new evidence arrives). The browser runs the same function while the
reviewer types, so feedback is instant — the server remains authoritative.

## Rules

| Code | Severity | Trigger |
|---|---|---|
| SUBJECTIVE_OUTCOME | blocker | best/worst/successful/popular/should/… in the question |
| TOO_FEW_OUTCOMES, DUPLICATE_OUTCOMES, BINARY_OUTCOME_COUNT | blocker | malformed outcome set |
| MISSING_CLOSE_DATE, CLOSE_IN_PAST | blocker | no/elapsed close time |
| CLOSE_AFTER_EVENT | blocker | close > event date (bets on known results) |
| EVENT_IN_PAST | blocker | event > 1 day ago |
| WEAK_RESOLUTION_CRITERIA | blocker | criteria < 40 chars |
| NO_RESOLUTION_SOURCE | blocker | no source name or URL |
| NO_SUPPORTING_SOURCES | blocker | no linked evidence |
| DUPLICATE_MARKET | blocker | ≥ 0.72 similarity to a live market |
| AMBIGUOUS_WORDING | warning | significant, major, soon, likely, around, … |
| NO_DEADLINE_IN_QUESTION | warning | no month/year/quarter/date in the question |
| COMPOUND_QUESTION | warning | ≥2 "and", or "or" (except "on or before" etc.) |
| QUESTION_FORMAT, QUESTION_TOO_SHORT | warning | not a question / < 25 chars |
| OUTCOMES_NOT_EXHAUSTIVE | warning | multi-outcome without Other/None |
| CLOSE_TOO_SOON, HORIZON_TOO_LONG | warning | < 24 h or > ~13 months |
| MISSING_EVENT_DATE | warning | no event/resolution date |
| NO_EDGE_CASE_HANDLING | warning | criteria don't mention postponement/cancellation |
| RESOLUTION_SOURCE_NO_URL, UNVERIFIED_RESOLUTION_SOURCE | warning | missing URL / domain not on trusted list |
| SINGLE_WEAK_SOURCE, STALE_SOURCES | warning | one non-official/major source; newest source > 14 days |
| CONFLICTING_SOURCES | warning | reported event dates differ by > 1 day |
| DUPLICATE_CANDIDATE | warning | ≥ 0.72 similar to another open candidate |
| ANALYZER_AMBIGUITY, LOW_CONFIDENCE | warning | model-reported issues; confidence < 0.5 |
| QUESTION_TOO_LONG, QUESTION_NOT_YES_NO, NO_TIMEZONE, THIN_DESCRIPTION, SINGLE_SOURCE, SIMILAR_EXISTS, HEURISTIC_GENERATED | info | minor |

## Deciding whether an event is suitable

1. Prefilter (cheap): upcoming explicit date, forward-looking language, event vocabulary, measurable quantities;
   opinion/galleries/live blogs are dropped. Every skip is stored with its reason.
2. Analyzer: the prompt defines suitability — a specific, objectively verifiable outcome, publicly known on a
   definite date between tomorrow and 12 months out. Unsuitable items are kept with the model's reason.
3. Validation: turns remaining doubts into blockers/warnings for the human.

## Handling ambiguous information

- The model must not invent facts; it lists doubts in `ambiguityNotes` and lowers `confidence` → warnings.
- Each article's own claimed event date is stored per source; disagreement → CONFLICTING_SOURCES, and an
  already-approved candidate is sent back to review.
- Tentative language ("pending approval", "people familiar") lowers confidence in the fallback analyzer.
- The reviewer resolves ambiguity by editing (dates, wording, criteria); every change is diffed and re-validated.

## Limitations

- Weights are hand-tuned; the score is a triage signal, not a calibrated probability.
- Word lists are English and lexical — "not insignificant" or paraphrased subjectivity can slip through;
  conversely a legitimate phrase can be flagged (warnings can be acknowledged; blockers require rewording).
- Similarity is lexical; paraphrases with little word overlap may not be detected as duplicates.
- The trusted-domain list is static.
- Resolution URLs are checked for format and domain, not fetched.
