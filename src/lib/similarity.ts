/**
 * Lightweight text similarity used for duplicate detection and in-run clustering.
 *
 * Deliberately simple and explainable: token Jaccard (after stop-word removal and light stemming)
 * blended with character-trigram Dice. Two questions about the same subject but different
 * deadlines ("...by October" vs "...by December") are distinct markets, so callers can apply a
 * date-distance penalty via `questionSimilarity`.
 *
 * Limitation: purely lexical — paraphrases with no shared vocabulary are missed. At scale this
 * would move to embeddings (pgvector) or pg_trgm indexes.
 */

const STOP_WORDS = new Set(
  (
    "a an the and or but if of to in on at by for with from as is are was were be been being will would " +
    "shall should can could may might must do does did has have had this that these those it its their " +
    "there than then into over under about after before between during until up down out off not no yes " +
    "what which who whom when where why how any all each more most other some such only own same so too very " +
    "says said new news report reports least end"
  ).split(/\s+/),
);

function stem(token: string): string {
  if (token.length > 5 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith("ed")) return token.slice(0, -2);
  if (token.length > 4 && /(ss|x|z|ch|sh)es$/.test(token)) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[$€£]/g, " ")
    .replace(/[^a-z0-9%.\s-]/g, " ")
    .replace(/(\d),(\d)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(text: string): string[] {
  return normalizeText(text)
    .split(/[\s-]+/)
    .map((t) => t.replace(/^\.+|\.+$/g, ""))
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t))
    .map(stem);
}

export function jaccard(a: Iterable<string>, b: Iterable<string>): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 && sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

function trigrams(text: string): Map<string, number> {
  const s = ` ${normalizeText(text)} `;
  const grams = new Map<string, number>();
  for (let i = 0; i < s.length - 2; i++) {
    const g = s.slice(i, i + 3);
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  return grams;
}

export function trigramDice(a: string, b: string): number {
  const ga = trigrams(a);
  const gb = trigrams(b);
  let total = 0;
  let inter = 0;
  for (const [g, n] of ga) {
    total += n;
    inter += Math.min(n, gb.get(g) ?? 0);
  }
  for (const n of gb.values()) total += n;
  return total === 0 ? 0 : (2 * inter) / total;
}

/** 0..1 similarity of two free-text strings. */
export function textSimilarity(a: string, b: string): number {
  return 0.6 * jaccard(tokenize(a), tokenize(b)) + 0.4 * trigramDice(a, b);
}

const DAY = 86_400_000;

/**
 * Similarity of two market questions, taking their event dates into account.
 * Same subject + deadlines more than 21 days apart are treated as different markets.
 */
export function questionSimilarity(
  a: { question: string; eventDate?: string | null; eventKey?: string | null },
  b: { question: string; eventDate?: string | null; eventKey?: string | null },
): number {
  if (a.eventKey && b.eventKey && a.eventKey === b.eventKey) return 1;
  let sim = textSimilarity(a.question, b.question);
  if (a.eventDate && b.eventDate) {
    const gap = Math.abs(Date.parse(a.eventDate) - Date.parse(b.eventDate)) / DAY;
    if (gap > 21) sim *= 0.55;
  }
  return Math.round(sim * 1000) / 1000;
}

export const DUPLICATE_BLOCK_THRESHOLD = 0.72;
export const DUPLICATE_WARN_THRESHOLD = 0.5;
