/**
 * Deterministic market-quality rules. Pure function: runs on the server (authoritative, stored
 * with the candidate) and in the browser (live feedback while a reviewer edits).
 *
 * Scoring: start at 100, subtract per issue (blocker 25, warning 8, info 2), clamp to 0..100.
 * The score is a triage signal for ordering the review queue, not a probability of correctness.
 * Any blocker prevents approval regardless of score.
 */
import type {
  CandidateEditInput,
  ReliabilityTier,
  SimilarItem,
  SourceFacts,
  ValidationIssue,
  ValidationReport,
} from "./domain";
import { DUPLICATE_BLOCK_THRESHOLD, DUPLICATE_WARN_THRESHOLD } from "./similarity";

export interface ValidationSourceInfo {
  url: string;
  publishedAt: string | null;
  reliability: ReliabilityTier;
  role: "primary" | "supporting" | "conflicting";
  facts: SourceFacts;
  sourceName: string;
}

export interface ValidationContext {
  now?: Date;
  sources: ValidationSourceInfo[];
  similar: SimilarItem[];
  ambiguityNotes?: string[];
  confidence?: number | null;
  generator?: string;
}

const PENALTY = { blocker: 25, warning: 8, info: 2 } as const;
const DAY = 86_400_000;

const VAGUE_TERMS = [
  "significant",
  "significantly",
  "major",
  "substantial",
  "soon",
  "likely",
  "many",
  "a lot",
  "large",
  "huge",
  "massive",
  "strong",
  "weak",
  "notable",
  "meaningful",
  "some",
  "several",
  "reasonable",
  "around",
  "approximately",
  "roughly",
  "about to",
];

const SUBJECTIVE_TERMS = [
  "best",
  "worst",
  "better",
  "worse",
  "successful",
  "success",
  "failure",
  "popular",
  "good",
  "bad",
  "impressive",
  "disappointing",
  "deserve",
  "should",
  "win the debate",
  "greatest",
  "beautiful",
  "controversial",
];

/** Domains considered reliable for resolution. Suffix match. */
export const TRUSTED_RESOLUTION_DOMAINS = [
  ".gov",
  ".gov.uk",
  ".gov.in",
  ".europa.eu",
  ".int",
  "federalreserve.gov",
  "bankofengland.co.uk",
  "ecb.europa.eu",
  "rbi.org.in",
  "nasa.gov",
  "spacex.com",
  "faa.gov",
  "reuters.com",
  "apnews.com",
  "bbc.co.uk",
  "bbc.com",
  "bloomberg.com",
  "ft.com",
  "wsj.com",
  "nytimes.com",
  "theguardian.com",
  "cnbc.com",
  "npr.org",
  "coingecko.com",
  "coinmarketcap.com",
  "espn.com",
  "fifa.com",
  "uefa.com",
  "nba.com",
  "nfl.com",
  "formula1.com",
  "olympics.com",
  "icc-cricket.com",
  "premierleague.com",
  "parliament.uk",
  "congress.gov",
  "whitehouse.gov",
  "supremecourt.gov",
  "sec.gov",
  "bls.gov",
  "bea.gov",
  "census.gov",
  "who.int",
  "un.org",
  "imf.org",
  "worldbank.org",
  "noaa.gov",
  "weather.gov",
  "nobelprize.org",
  "oscars.org",
  "apple.com",
  "microsoft.com",
  "google.com",
  "openai.com",
  "tesla.com",
];

export function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function isTrustedDomain(url: string): boolean {
  const host = hostnameOf(url);
  if (!host) return false;
  return TRUSTED_RESOLUTION_DOMAINS.some((d) =>
    d.startsWith(".") ? host.endsWith(d) : host === d || host.endsWith(`.${d}`),
  );
}

function findTerms(text: string, terms: string[]): string[] {
  const lower = ` ${text.toLowerCase()} `;
  return terms.filter((t) => new RegExp(`[^a-z]${t.replace(/\s+/g, "\\s+")}[^a-z]`).test(lower));
}

const MONTHS =
  "(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)";
const TIME_REFERENCE = new RegExp(
  `(\\b${MONTHS}\\b|\\b20\\d\\d\\b|\\bq[1-4]\\b|\\b\\d{1,2}/\\d{1,2}\\b|end of (the )?(year|month|week|quarter)|\\btoday\\b|\\btomorrow\\b)`,
  "i",
);

export function validateCandidate(input: CandidateEditInput, ctx: ValidationContext): ValidationReport {
  const now = ctx.now ?? new Date();
  const issues: ValidationIssue[] = [];
  const add = (issue: ValidationIssue) => issues.push(issue);
  const q = input.question.trim();

  /* ---------------- Question wording ---------------- */
  if (!q.endsWith("?")) {
    add({ code: "QUESTION_FORMAT", severity: "warning", field: "question", message: "Question should be phrased as a question ending with '?'." });
  }
  if (q.length < 25) {
    add({ code: "QUESTION_TOO_SHORT", severity: "warning", field: "question", message: "Question is very short and may lack necessary specifics." });
  }
  if (q.length > 200) {
    add({ code: "QUESTION_TOO_LONG", severity: "info", field: "question", message: "Question is long; move detail into the description or resolution criteria." });
  }
  const vague = findTerms(q, VAGUE_TERMS);
  if (vague.length) {
    add({
      code: "AMBIGUOUS_WORDING",
      severity: "warning",
      field: "question",
      message: `Question uses vague terms: ${vague.map((v) => `"${v}"`).join(", ")}.`,
      hint: "Replace with a measurable threshold (e.g. 'by at least 0.25 percentage points').",
    });
  }
  const subjective = findTerms(q, SUBJECTIVE_TERMS);
  if (subjective.length) {
    add({
      code: "SUBJECTIVE_OUTCOME",
      severity: "blocker",
      field: "question",
      message: `Outcome depends on judgement: ${subjective.map((v) => `"${v}"`).join(", ")}.`,
      hint: "Rewrite so any two people reading the resolution source would agree on the answer.",
    });
  }
  if (input.outcomeType === "binary" && !/^(will|is|are|does|do|did|has|have|can|would|should)\b/i.test(q)) {
    add({ code: "QUESTION_NOT_YES_NO", severity: "info", field: "question", message: "Binary questions usually start with 'Will …'." });
  }
  if (!TIME_REFERENCE.test(q)) {
    add({ code: "NO_DEADLINE_IN_QUESTION", severity: "warning", field: "question", message: "Question does not state a date or deadline.", hint: "Add 'by <date>' or 'on <date>' so the time window is unambiguous." });
  }
  const multipleConditions = (q.match(/\band\b/gi) ?? []).length >= 2 || /\bor\b(?!\s+(before|after|earlier|later|more|less|higher|lower|above|below))/i.test(q);
  if (multipleConditions && input.outcomeType === "binary") {
    add({ code: "COMPOUND_QUESTION", severity: "warning", field: "question", message: "Question may combine several conditions ('and'/'or'), which makes resolution ambiguous." });
  }

  /* ---------------- Outcomes ---------------- */
  const labels = input.outcomes.map((o) => o.label.trim().toLowerCase());
  if (input.outcomes.length < 2) {
    add({ code: "TOO_FEW_OUTCOMES", severity: "blocker", field: "outcomes", message: "A market needs at least two outcomes." });
  }
  if (new Set(labels).size !== labels.length) {
    add({ code: "DUPLICATE_OUTCOMES", severity: "blocker", field: "outcomes", message: "Outcome labels must be unique." });
  }
  if (input.outcomeType === "binary" && input.outcomes.length !== 2) {
    add({ code: "BINARY_OUTCOME_COUNT", severity: "blocker", field: "outcomes", message: "Binary markets must have exactly two outcomes." });
  }
  if (input.outcomeType === "multiple" && input.outcomes.length > 2 && !labels.some((l) => /other|none|field|neither/.test(l))) {
    add({ code: "OUTCOMES_NOT_EXHAUSTIVE", severity: "warning", field: "outcomes", message: "Multi-outcome markets should include a catch-all such as 'Other'.", hint: "Ensures the market can always resolve." });
  }

  /* ---------------- Dates ---------------- */
  const close = input.closeDate ? new Date(input.closeDate) : null;
  const event = input.eventDate ? new Date(input.eventDate) : null;
  if (!close) {
    add({ code: "MISSING_CLOSE_DATE", severity: "blocker", field: "closeDate", message: "No closing time: trading must stop at a defined time." });
  } else {
    if (close.getTime() <= now.getTime()) {
      add({ code: "CLOSE_IN_PAST", severity: "blocker", field: "closeDate", message: "Closing time is in the past." });
    } else if (close.getTime() - now.getTime() < DAY) {
      add({ code: "CLOSE_TOO_SOON", severity: "warning", field: "closeDate", message: "Market would close in less than 24 hours — little time to trade." });
    }
    if (close.getTime() - now.getTime() > 400 * DAY) {
      add({ code: "HORIZON_TOO_LONG", severity: "warning", field: "closeDate", message: "Market closes more than ~13 months from now; long-dated markets see little liquidity." });
    }
  }
  if (!event) {
    add({ code: "MISSING_EVENT_DATE", severity: "warning", field: "eventDate", message: "No event / resolution date given; reviewers cannot tell when the market resolves." });
  } else if (close && close.getTime() > event.getTime()) {
    add({
      code: "CLOSE_AFTER_EVENT",
      severity: "blocker",
      field: "closeDate",
      message: "Market closes after the event happens — traders could bet on a known result.",
      hint: "Close at or before the event start.",
    });
  }
  if (event && event.getTime() < now.getTime() - DAY) {
    add({ code: "EVENT_IN_PAST", severity: "blocker", field: "eventDate", message: "Event date is already in the past." });
  }

  /* ---------------- Resolution ---------------- */
  const criteria = input.resolutionCriteria.trim();
  if (criteria.length < 40) {
    add({ code: "WEAK_RESOLUTION_CRITERIA", severity: "blocker", field: "resolutionCriteria", message: "Resolution criteria are missing or too thin to resolve unambiguously." });
  } else {
    if (!/(postpon|cancel|delay|resched|does not (take place|occur)|not held)/i.test(criteria)) {
      add({
        code: "NO_EDGE_CASE_HANDLING",
        severity: "warning",
        field: "resolutionCriteria",
        message: "Criteria don't say what happens if the event is postponed or cancelled.",
      });
    }
    if (!/(utc|gmt|[+-]\d{2}:?\d{2}|\bet\b|\bist\b|time zone|timezone)/i.test(criteria) && !/\d{1,2}:\d{2}/.test(criteria)) {
      add({ code: "NO_TIMEZONE", severity: "info", field: "resolutionCriteria", message: "Criteria don't specify a time zone for the deadline." });
    }
  }
  if (!input.resolutionSourceUrl && !input.resolutionSourceName.trim()) {
    add({ code: "NO_RESOLUTION_SOURCE", severity: "blocker", field: "resolutionSourceUrl", message: "No resolution source: nobody can verify the outcome." });
  } else if (!input.resolutionSourceUrl) {
    add({ code: "RESOLUTION_SOURCE_NO_URL", severity: "warning", field: "resolutionSourceUrl", message: "Resolution source has no URL." });
  } else if (!isTrustedDomain(input.resolutionSourceUrl)) {
    add({
      code: "UNVERIFIED_RESOLUTION_SOURCE",
      severity: "warning",
      field: "resolutionSourceUrl",
      message: `Resolution source (${hostnameOf(input.resolutionSourceUrl) ?? "unknown"}) is not on the trusted-source list.`,
      hint: "Prefer an official body or a major wire service.",
    });
  }
  if (input.description.trim().length < 40) {
    add({ code: "THIN_DESCRIPTION", severity: "info", field: "description", message: "Description gives traders little context." });
  }

  /* ---------------- Evidence ---------------- */
  const evidence = ctx.sources.filter((s) => s.role !== "conflicting");
  if (ctx.sources.length === 0) {
    add({ code: "NO_SUPPORTING_SOURCES", severity: "blocker", message: "No supporting source is linked to this candidate." });
  } else if (evidence.length === 1) {
    const s = evidence[0];
    if (s.reliability === "community" || s.reliability === "aggregator" || s.reliability === "synthetic") {
      add({ code: "SINGLE_WEAK_SOURCE", severity: "warning", message: `Only one supporting source (${s.sourceName}) and it is not an official or major outlet.` });
    } else {
      add({ code: "SINGLE_SOURCE", severity: "info", message: "Only one supporting source; corroboration would increase confidence." });
    }
  }
  const newest = Math.max(...ctx.sources.map((s) => (s.publishedAt ? Date.parse(s.publishedAt) : 0)), 0);
  if (ctx.sources.length && newest > 0 && now.getTime() - newest > 14 * DAY) {
    add({ code: "STALE_SOURCES", severity: "warning", message: "Newest supporting source is more than 14 days old; facts may have changed." });
  }

  // Conflicts: sources that report different event dates (more than 1 day apart).
  const reportedDates = ctx.sources
    .map((s) => ({ name: s.sourceName, date: s.facts?.eventDate ? Date.parse(s.facts.eventDate) : NaN }))
    .filter((d) => !Number.isNaN(d.date));
  if (reportedDates.length >= 2) {
    const min = Math.min(...reportedDates.map((d) => d.date));
    const max = Math.max(...reportedDates.map((d) => d.date));
    if (max - min > DAY) {
      const fmt = (t: number) => new Date(t).toISOString().slice(0, 10);
      add({
        code: "CONFLICTING_SOURCES",
        severity: "warning",
        field: "eventDate",
        message: `Sources disagree on the event date (${fmt(min)} vs ${fmt(max)}).`,
        hint: "Confirm the date with the official source and state which date governs resolution.",
      });
    }
  }

  /* ---------------- Duplicates ---------------- */
  for (const s of ctx.similar) {
    if (s.kind === "candidate" && s.status === "rejected") continue;
    const pct = Math.round(s.similarity * 100);
    if (s.similarity >= DUPLICATE_BLOCK_THRESHOLD) {
      add({
        code: s.kind === "market" ? "DUPLICATE_MARKET" : "DUPLICATE_CANDIDATE",
        severity: s.kind === "market" ? "blocker" : "warning",
        message: `${pct}% similar to existing ${s.kind === "market" ? "live market" : "candidate"}: "${s.question}"`,
        hint: s.kind === "market" ? "Reject as duplicate or change the question materially." : "Merge or reject one of them.",
      });
    } else if (s.similarity >= DUPLICATE_WARN_THRESHOLD) {
      add({ code: "SIMILAR_EXISTS", severity: "info", message: `${pct}% similar to existing ${s.kind}: "${s.question}"` });
    }
  }

  /* ---------------- Analyzer signals ---------------- */
  for (const note of ctx.ambiguityNotes ?? []) {
    add({ code: "ANALYZER_AMBIGUITY", severity: "warning", message: note });
  }
  if (ctx.confidence != null && ctx.confidence < 0.5) {
    add({ code: "LOW_CONFIDENCE", severity: "warning", message: `Analyzer confidence is low (${Math.round(ctx.confidence * 100)}%).` });
  }
  if (ctx.generator?.startsWith("heuristic")) {
    add({ code: "HEURISTIC_GENERATED", severity: "info", message: "Generated by the rule-based fallback analyzer (no LLM). Review wording carefully." });
  }

  const blockers = issues.filter((i) => i.severity === "blocker").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const penalty = issues.reduce((sum, i) => sum + PENALTY[i.severity], 0);
  const order = { blocker: 0, warning: 1, info: 2 } as const;
  issues.sort((a, b) => order[a.severity] - order[b.severity]);
  return {
    issues,
    score: Math.max(0, Math.min(100, 100 - penalty)),
    blockers,
    warnings,
    checkedAt: now.toISOString(),
  };
}
