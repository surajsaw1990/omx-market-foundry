/**
 * Rule-based fallback analyzer, used when no GROQ_API_KEY is configured (or LLM_PROVIDER=heuristic).
 * It is intentionally conservative: it only drafts a market when it finds an explicit upcoming date,
 * derives the question from headline patterns, and always reports low confidence so the validation
 * layer surfaces the draft for careful human rewriting.
 */
import type { Category } from "@/lib/domain";
import { tokenize } from "@/lib/similarity";
import { firstFutureDate } from "../discovery/signals";
import type { AnalysisDraft, AnalysisInput, AnalysisResult, Analyzer } from "./types";

const DAY = 86_400_000;

const CATEGORY_RULES: [RegExp, Category][] = [
  [/\b(bitcoin|ethereum|crypto|btc|eth|solana|stablecoin|etf inflows?)\b/i, "Crypto"],
  [/\b(federal reserve|fed\b|fomc|ecb|central bank|interest.rate|inflation|cpi|gdp|payrolls|unemployment|bank of england)\b/i, "Economics"],
  [/\b(ipo|nasdaq|nyse|shares|stock|earnings|merger|acquisition)\b/i, "Finance"],
  [/\b(election|parliament|congress|senate|vote|referendum|minister|president|bill|directive|law)\b/i, "Politics"],
  [/\b(spacex|starship|nasa|rocket|launch|mission|satellite|telescope)\b/i, "Science"],
  [/\b(ai|software|iphone|apple|google|microsoft|openai|chip|semiconductor)\b/i, "Technology"],
  [/\b(test match|third test|cricket|football|premier league|final|grand prix|tournament|championship|cup|nba|nfl|tennis|open)\b/i, "Sports"],
  [/\b(hurricane|storm|climate|temperature|weather|flood)\b/i, "Climate & Weather"],
];

const RESOLUTION_SOURCES: [RegExp, string, string][] = [
  [/\b(federal reserve|fomc|fed\b)/i, "Federal Reserve — FOMC statements", "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm"],
  [/\b(ecb|european central bank)\b/i, "European Central Bank — Monetary policy decisions", "https://www.ecb.europa.eu/press/govcdec/mopo/html/index.en.html"],
  [/\b(starship|spacex)\b/i, "SpaceX official launch updates", "https://www.spacex.com/launches/"],
  [/\bnasa\b/i, "NASA", "https://www.nasa.gov/news/"],
  [/\b(bitcoin|btc)\b/i, "CoinGecko BTC/USD daily close", "https://www.coingecko.com/en/coins/bitcoin"],
  [/\beuropean parliament|meps?\b/i, "European Parliament — Plenary results", "https://www.europarl.europa.eu/plenary/en/votes.html"],
  [/\bnasdaq\b/i, "Nasdaq IPO calendar", "https://www.nasdaq.com/market-activity/ipos"],
  [/\b(cricket|test match|third test)\b/i, "ICC — Match centre", "https://www.icc-cricket.com/"],
  [/\bpremier league\b/i, "Premier League", "https://www.premierleague.com/"],
];

function fmt(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function cleanHeadline(title: string, dateText: string | null): string {
  let t = title.split(/\s[—|–]\s|:\s(?=[A-Z])/)[0];
  t = t.replace(/,\s*(pending|people familiar|sources say|according to|as |with ).*$/i, "");
  if (dateText) {
    const escaped = dateText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    t = t.replace(new RegExp(`\\s*(on|for|by|from|starting|until|to)?\\s*${escaped}`, "i"), " ");
  }
  return t.replace(/\s+/g, " ").replace(/[,\s]+$/, "").trim();
}

function draftQuestion(title: string, summary: string, dateText: string | null, when: string): { question: string; predicate: string; pattern: string } {
  const text = `${title} ${summary}`;
  const price = /\b([A-Z][a-zA-Z]+)\b[^.]*?\b(?:close|closes|climbs?|rises?|trade|trades|falls?|drops?)\s+(above|below|toward|towards|to)\s+\$([\d,]+)/.exec(text);
  if (price) {
    const dir = price[2] === "below" ? "below" : "above";
    return { question: `Will ${price[1]} close ${dir} $${price[3]} on ${when}?`, predicate: `${price[1]} closes ${dir} $${price[3]}`, pattern: "price-threshold" };
  }
  const headline = cleanHeadline(title, dateText);
  const delayed = /^(.+?)\s+(slips|is delayed|delayed|pushed back|moved|postponed)(\s+to)?$/i.exec(headline);
  if (delayed) {
    return { question: `Will the ${delayed[1]} take place on or before ${when}?`, predicate: `the ${delayed[1]} takes place`, pattern: "schedule-change" };
  }
  const targets = /^(.+?)\s+targets?\s+(?:for\s+)?(.+)$/i.exec(headline);
  if (targets && targets[2].length > 3) {
    const rest = targets[2].replace(/^for\s+/i, "").replace(/^(the\s+)?/i, "the ");
    return { question: `Will ${targets[1]} carry out ${rest} on or before ${when}?`, predicate: `${targets[1]} carries out ${rest}`, pattern: "target-date" };
  }
  const plan = /^(.+?)\s+(?:is |are )?(?:set to|expected to|scheduled to|poised to|plans? to|due to|to|will)\s+(.+)$/i.exec(headline);
  if (plan && plan[2].split(" ").length >= 2) {
    const subject = /^(federal|european|supreme|us|uk|bank|house|senate)\b/i.test(plan[1]) ? `the ${plan[1]}` : plan[1];
    return { question: `Will ${subject} ${plan[2]} by ${when}?`, predicate: `${subject} ${plan[2]}`, pattern: "scheduled-action" };
  }
  return {
    question: `Will the event "${headline}" take place as scheduled on ${when}?`,
    predicate: `the event described as "${headline}" takes place`,
    pattern: "generic",
  };
}

function eventKeyFor(title: string, date: Date): string {
  const proper = (title.match(/\b[A-Z][a-zA-Z]{2,}\b/g) ?? []).filter(
    (w) => !/^(January|February|March|April|May|June|July|August|September|October|November|December|The|Will|And|For)$/.test(w),
  );
  const tokens = [...new Set([...proper.map((w) => w.toLowerCase()), ...tokenize(title).filter((t) => /^(flight|test|vote|ipo|rate|decision|launch|final|match|election|price|close)$/.test(t))])];
  return `${tokens.slice(0, 5).join("-") || "event"}-${date.toISOString().slice(0, 7)}`;
}

export class HeuristicAnalyzer implements Analyzer {
  readonly name = "heuristic";

  async analyze(input: AnalysisInput, now: Date): Promise<AnalysisResult> {
    const generator = "heuristic:v1";
    const unsuitable = (reason: string): AnalysisResult => ({
      generator,
      draft: {
        suitable: false,
        unsuitableReason: reason,
        eventSummary: "",
        eventKey: "",
        question: "",
        category: "Other",
        description: "",
        outcomeType: "binary",
        outcomes: [],
        eventDate: null,
        closeDate: null,
        resolutionCriteria: "",
        resolutionSourceName: "",
        resolutionSourceUrl: "",
        tags: [],
        facts: { eventDate: null, keyClaims: [] },
        ambiguityNotes: [],
        confidence: 0.2,
        rationale: reason,
      },
    });

    if (/^(opinion|comment|analysis|editorial|in pictures|watch|listen)\b/i.test(input.title)) {
      return unsuitable("Opinion or media piece — no verifiable event.");
    }
    const found = firstFutureDate(input.title, now) ?? firstFutureDate(input.summary, now);
    if (!found) return unsuitable("No explicit upcoming date found in the item.");
    if (found.date.getTime() - now.getTime() > 400 * DAY) return unsuitable("Event is more than ~13 months away.");

    const eventDate = new Date(found.date);
    eventDate.setUTCHours(18, 0, 0, 0);
    const closeDate = new Date(Date.UTC(eventDate.getUTCFullYear(), eventDate.getUTCMonth(), eventDate.getUTCDate(), 0, 0, 0));
    const when = fmt(eventDate);
    const inTitle = firstFutureDate(input.title, now)?.text ?? null;
    const { question, predicate, pattern } = draftQuestion(input.title, input.summary, inTitle, when);
    if (pattern === "generic" && !inTitle) {
      // Without an LLM we only trust generic headlines when the headline itself carries the date.
      return unsuitable("Headline does not describe a scheduled, verifiable event (date only appears in the body).");
    }

    const text = `${input.title} ${input.summary}`;
    const category = CATEGORY_RULES.find(([re]) => re.test(text))?.[1] ?? input.categoryHint ?? "Other";
    const res = RESOLUTION_SOURCES.find(([re]) => re.test(text));
    const sourceName = res?.[1] ?? input.sourceName;
    const sourceUrl = res?.[2] ?? (() => {
      try {
        return new URL(input.url).origin;
      } catch {
        return "";
      }
    })();

    const notes: string[] = [];
    if (pattern === "generic") notes.push("Headline did not match a known pattern, so the question is generic.");
    if (/\b(pending|expected|could|may|people familiar|sources say|not yet)\b/i.test(text)) notes.push("Source language is tentative (e.g. 'pending', 'expected'); the date may change.");

    return {
      generator,
      draft: {
        suitable: true,
        unsuitableReason: null,
        eventSummary: input.title,
        eventKey: eventKeyFor(input.title, eventDate),
        question,
        category,
        description: input.summary.replace(/\s*\[Synthetic demo article\]\s*/g, " ").trim().slice(0, 600),
        outcomeType: "binary",
        outcomes: [{ label: "Yes" }, { label: "No" }],
        eventDate: eventDate.toISOString(),
        closeDate: closeDate.toISOString(),
        resolutionCriteria: `Resolves YES if ${sourceName} confirms that ${predicate} on or before ${when}, 23:59 UTC. Resolves NO otherwise, including if the event is postponed beyond that time or cancelled.`,
        resolutionSourceName: sourceName,
        resolutionSourceUrl: sourceUrl,
        tags: [category.toLowerCase()],
        facts: { eventDate: eventDate.toISOString(), keyClaims: [input.title] },
        ambiguityNotes: notes,
        confidence: pattern === "generic" ? 0.3 : 0.45,
        rationale: `Explicit upcoming date (${found.text}) and a ${pattern.replace("-", " ")} pattern in the headline.`,
      } satisfies AnalysisDraft,
    };
  }
}
