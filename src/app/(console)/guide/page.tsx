import { AlertOctagon, AlertTriangle, Info } from "lucide-react";
import type { Metadata } from "next";
import { Card, CardHeader, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "How it works" };

const STAGES = [
  ["Discover", "Enabled sources (RSS/Atom feeds from official bodies and major outlets, plus a synthetic demo feed) are fetched in parallel with timeouts and one retry. A failing source is isolated: it is marked unhealthy and the run continues."],
  ["De-duplicate", "Every article URL is canonicalised (tracking params removed) and hashed. Re-fetching the same article is a no-op, so repeated runs never re-analyse old news."],
  ["Prefilter", "A cheap, explainable score (upcoming date, forward-looking language, event keywords, numbers; opinion/gallery penalties) decides which items are worth an LLM call. Everything below the threshold is kept with its reason."],
  ["Cluster", "Near-identical headlines from different feeds in the same run are grouped and analysed once; the others become supporting sources."],
  ["Analyze & structure", "Groq (Llama 3.3 70B, falling back to Llama 3.1 8B on rate limits) returns strict JSON: suitability, question, outcomes, event/close dates, resolution criteria & source, event key, facts reported by this article, ambiguity notes and confidence. Output is schema-validated with one repair attempt; failures mark the item as failed (re-queueable) instead of creating a bad candidate."],
  ["Merge", "If the event already has a candidate (same/similar event key within 45 days, or ≥72% question similarity) the article is attached as evidence instead of creating a duplicate. Conflicting reported dates are flagged, and an approved candidate is sent back to review."],
  ["Validate", "Deterministic rules (below) produce blockers, warnings and notes, and a 0–100 quality score used to order the queue."],
  ["Review", "A signed-in reviewer edits, approves (blockers must be zero; warnings must be acknowledged) or rejects with a reason. Every change is versioned, diffed and audited; optimistic locking prevents lost updates."],
  ["Create", "Approved candidates are sent to the OmniMarketX market API boundary with an Idempotency-Key, so retries or double clicks never create two markets. The market keeps full provenance."],
];

const RULES: [string, "blocker" | "warning" | "info", string][] = [
  ["SUBJECTIVE_OUTCOME", "blocker", "Words like best, successful, popular make resolution a matter of opinion."],
  ["MISSING_CLOSE_DATE / CLOSE_IN_PAST", "blocker", "Trading must stop at a defined future time."],
  ["CLOSE_AFTER_EVENT", "blocker", "Closing after the event lets traders bet on a known result."],
  ["EVENT_IN_PAST", "blocker", "The event already happened."],
  ["WEAK_RESOLUTION_CRITERIA", "blocker", "Criteria missing or too short to resolve unambiguously."],
  ["NO_RESOLUTION_SOURCE", "blocker", "Nobody could verify the outcome."],
  ["TOO_FEW / DUPLICATE_OUTCOMES, BINARY_OUTCOME_COUNT", "blocker", "Outcome set is malformed."],
  ["DUPLICATE_MARKET", "blocker", "≥72% similar to a live market (after date adjustment)."],
  ["NO_SUPPORTING_SOURCES", "blocker", "No evidence linked."],
  ["AMBIGUOUS_WORDING", "warning", "Vague terms (significant, soon, major…) instead of thresholds."],
  ["NO_DEADLINE_IN_QUESTION", "warning", "The question itself should state the date."],
  ["COMPOUND_QUESTION", "warning", "Several conditions joined by and/or."],
  ["NO_EDGE_CASE_HANDLING", "warning", "Criteria don't cover postponement or cancellation."],
  ["UNVERIFIED_RESOLUTION_SOURCE", "warning", "Resolution domain is not on the trusted list (official bodies, wires, leagues…)."],
  ["CONFLICTING_SOURCES", "warning", "Linked sources report event dates more than a day apart."],
  ["DUPLICATE_CANDIDATE", "warning", "Another open candidate covers the same thing."],
  ["SINGLE_WEAK_SOURCE / STALE_SOURCES", "warning", "Thin or old evidence."],
  ["ANALYZER_AMBIGUITY / LOW_CONFIDENCE", "warning", "The model itself reported uncertainty."],
  ["CLOSE_TOO_SOON / HORIZON_TOO_LONG / MISSING_EVENT_DATE", "warning", "Timing makes the market hard to trade or resolve."],
  ["NO_TIMEZONE, THIN_DESCRIPTION, SINGLE_SOURCE, SIMILAR_EXISTS, HEURISTIC_GENERATED", "info", "Worth a look; small score impact."],
];

const ICON = {
  blocker: <AlertOctagon className="size-3.5 text-bad" />,
  warning: <AlertTriangle className="size-3.5 text-warn" />,
  info: <Info className="size-3.5 text-info" />,
};

export default function GuidePage() {
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Documentation" title="How it works" description="What the system does at each step, how candidates are scored, and where the limits are." />
      <Card>
        <CardHeader title="Pipeline" />
        <ol className="grid gap-px overflow-hidden rounded-b-[14px] border-t border-line bg-line md:grid-cols-3">
          {STAGES.map(([title, text], i) => (
            <li key={title} className="bg-panel p-5">
              <div className="font-mono text-[11px] text-accent">{String(i + 1).padStart(2, "0")}</div>
              <div className="mt-1 text-sm font-semibold">{title}</div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{text}</p>
            </li>
          ))}
        </ol>
      </Card>
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader title="Validation rules" description="Score = 100 − 25 per blocker − 8 per warning − 2 per note (min 0)." />
          <div className="divide-y divide-line border-t border-line">
            {RULES.map(([code, sev, text]) => (
              <div key={code} className="grid gap-1 px-5 py-2.5 sm:grid-cols-[minmax(0,260px)_1fr] sm:gap-4">
                <div className="flex items-start gap-2 font-mono text-[11px] text-fg/90">
                  <span className="mt-0.5">{ICON[sev]}</span>
                  {code}
                </div>
                <div className="text-[13px] text-muted">{text}</div>
              </div>
            ))}
          </div>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Candidate status" />
            <div className="space-y-2 px-5 pb-5 font-mono text-[12px] text-muted">
              <div>pending_review → approved | rejected</div>
              <div>approved → market_created | rejected</div>
              <div>approved → pending_review (edit / reopen / new conflicting source)</div>
              <div>rejected → pending_review (reopen)</div>
              <div>market_created → (final, read-only)</div>
            </div>
          </Card>
          <Card>
            <CardHeader title="Known limitations" />
            <ul className="list-disc space-y-2 px-5 pb-5 pl-9 text-[13px] text-muted">
              <li>The quality score is a triage signal, not a probability that the market is good. Weights are hand-set.</li>
              <li>Similarity is lexical (tokens + trigrams). Paraphrases with no shared words can slip through; embeddings would fix this at scale.</li>
              <li>RSS summaries are short; the model sees headline + summary, not full articles.</li>
              <li>The trusted-domain list is static and conservative.</li>
              <li>LLM output can still be wrong in plausible ways — which is why a human approves every market.</li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
