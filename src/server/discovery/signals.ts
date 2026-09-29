/**
 * Cheap, deterministic text signals. Used (1) as a prefilter so we only spend LLM quota on items
 * that plausibly describe a future, measurable event, and (2) by the heuristic fallback analyzer.
 */

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5,
  jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10,
  november: 10, dec: 11, december: 11,
};
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";

export interface FoundDate {
  date: Date;
  text: string;
  index: number;
}

/**
 * Finds explicit calendar dates ("October 14, 2026", "14 Oct 2026", "2026-10-14", "Oct 14").
 * Dates without a year are resolved to the next occurrence relative to `ref`.
 */
export function extractDates(text: string, ref: Date = new Date()): FoundDate[] {
  const found: FoundDate[] = [];
  const push = (y: number | null, m: number, d: number, raw: string, index: number) => {
    if (m < 0 || m > 11 || d < 1 || d > 31) return;
    let year = y ?? ref.getUTCFullYear();
    let date = new Date(Date.UTC(year, m, d, 12));
    if (y === null && date.getTime() < ref.getTime() - 60 * 86_400_000) {
      year += 1;
      date = new Date(Date.UTC(year, m, d, 12));
    }
    if (date.getUTCDate() !== d) return; // e.g. Feb 31
    found.push({ date, text: raw, index });
  };

  const patterns: [RegExp, (m: RegExpExecArray) => void][] = [
    [/\b(20\d\d)-(\d{2})-(\d{2})\b/g, (m) => push(+m[1], +m[2] - 1, +m[3], m[0], m.index)],
    [new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(20\\d\\d))?\\b`, "gi"), (m) =>
      push(m[3] ? +m[3] : null, MONTHS[m[1].toLowerCase().replace(".", "")] ?? -1, +m[2], m[0], m.index)],
    [new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE}(?:,?\\s+(20\\d\\d))?\\b`, "gi"), (m) =>
      push(m[3] ? +m[3] : null, MONTHS[m[2].toLowerCase().replace(".", "")] ?? -1, +m[1], m[0], m.index)],
  ];
  for (const [re, fn] of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) fn(m);
  }
  // De-duplicate overlapping matches of the same day.
  const seen = new Set<string>();
  return found
    .sort((a, b) => a.index - b.index)
    .filter((f) => {
      const k = f.date.toISOString().slice(0, 10);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

export function firstFutureDate(text: string, ref: Date = new Date()): FoundDate | null {
  return extractDates(text, ref).find((f) => f.date.getTime() > ref.getTime() - 12 * 3_600_000) ?? null;
}

const FUTURE_PHRASES = /\b(will|to (vote|decide|announce|launch|release|hold|meet|rule|publish|price|list|face|begin|start)|set to|expected to|scheduled|plans? to|targets?|due (to|on|in)|upcoming|next (week|month|year|round|meeting)|deadline|countdown|ahead of|preview|poised to|could|may|looms?)\b/i;
const EVENT_WORDS = /\b(election|vote|referendum|ballot|decision|rate|rates|inflation|cpi|gdp|jobs report|payrolls|launch|release|final|semi-?final|match|test|cup|championship|grand prix|tournament|ruling|verdict|trial|court|summit|earnings|results|ipo|listing|approval|approve|licen[cs]e|merger|acquisition|deal|tariff|ceasefire|bill|law|legislation|budget|strike|mission|flight|award|oscars?|nominat|debate|poll|price|record|meeting|policy)\b/gi;
const NUMERIC = /(\$\s?\d|\d+(\.\d+)?\s?(%|percent|bps|basis points|million|billion|trillion|k\b))/i;
const NEGATIVE = /\b(opinion|comment|column|editorial|analysis:|review:|in pictures|photos?:|gallery|watch:|video:|listen:|podcast|quiz|obituary|dies at|recipe|how to|explainer|what we know|live:|live updates|letters?:|newsletter|horoscope|crossword)\b/i;

export interface PrefilterResult {
  score: number;
  reasons: string[];
}

/** 0..1 "could this be a market?" score with human-readable reasons. */
export function prefilterScore(title: string, summary: string, ref: Date = new Date()): PrefilterResult {
  const text = `${title}. ${summary}`;
  const reasons: string[] = [];
  let score = 0;

  if (NEGATIVE.test(title)) {
    return { score: 0.05, reasons: ["Looks like opinion/gallery/live-blog content"] };
  }
  const future = firstFutureDate(text, ref);
  if (future) {
    score += 0.4;
    reasons.push(`Mentions an upcoming date (${future.text})`);
  }
  if (FUTURE_PHRASES.test(text)) {
    score += 0.25;
    reasons.push("Forward-looking language");
  }
  const events = new Set((text.match(EVENT_WORDS) ?? []).map((w) => w.toLowerCase()));
  if (events.size) {
    score += Math.min(0.25, 0.1 * events.size);
    reasons.push(`Event keywords: ${[...events].slice(0, 4).join(", ")}`);
  }
  if (NUMERIC.test(text)) {
    score += 0.1;
    reasons.push("Contains measurable quantities");
  }
  if (summary.length < 40) score -= 0.1;
  return { score: Math.max(0, Math.min(1, Math.round(score * 100) / 100)), reasons };
}
