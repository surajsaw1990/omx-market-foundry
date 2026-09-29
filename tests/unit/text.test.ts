import { describe, expect, it } from "vitest";
import { questionSimilarity, textSimilarity, tokenize } from "@/lib/similarity";
import { extractDates, firstFutureDate, prefilterScore } from "@/server/discovery/signals";
import { findMergeTarget, normalizeDraft } from "@/server/discovery/pipeline";
import { canonicalUrl, urlHash } from "@/server/sources/fetcher";
import { parseFeed } from "@/server/sources/rss";
import { SAMPLE_RSS } from "../helpers";

describe("similarity", () => {
  it("tokenizes with stop-words removed and light stemming", () => {
    expect(tokenize("Will the Fed cut rates in October?")).toEqual(["fed", "cut", "rate", "october"]);
  });
  it("scores near-identical questions high and unrelated ones low", () => {
    expect(textSimilarity("Will Bitcoin close above $150,000 on October 31?", "Will Bitcoin close above $150,000 by October 31?")).toBeGreaterThan(0.8);
    expect(textSimilarity("Will Bitcoin close above $150,000?", "Will Arsenal win the Premier League?")).toBeLessThan(0.2);
  });
  it("treats the same subject with far-apart dates as a different market", () => {
    const a = { question: "Will Bitcoin close above $150,000 on October 31, 2026?", eventDate: "2026-10-31T00:00:00Z" };
    const b = { question: "Will Bitcoin close above $150,000 on December 31, 2026?", eventDate: "2026-12-31T00:00:00Z" };
    expect(questionSimilarity(a, b)).toBeLessThan(0.72);
    expect(questionSimilarity({ ...a, eventKey: "k" }, { ...b, eventKey: "k" })).toBe(1);
  });
  it("merges reports of the same event via event-key overlap, not different events", () => {
    const existing = [{ id: "c1", question: "Will SpaceX conduct the next Starship flight test by October 8, 2026?", eventDate: "2026-10-08T00:00:00Z", eventKey: "spacex-starship-flight-test-2026-10", status: "pending_review" }];
    expect(findMergeTarget(existing, { question: "Will the Starship test take place before October 15?", eventDate: "2026-10-15T00:00:00Z", eventKey: "starship-flight-test-2026-10" })?.target.id).toBe("c1");
    expect(findMergeTarget(existing, { question: "Will the ECB cut rates on October 30, 2026?", eventDate: "2026-10-30T00:00:00Z", eventKey: "ecb-rate-decision-2026-10" })).toBeNull();
  });
});

describe("signals", () => {
  const ref = new Date("2026-09-29T12:00:00Z");
  it("extracts several date formats and resolves missing years forward", () => {
    const found = extractDates("Vote on October 14, 2026; hearing 3 Nov 2026; report 2026-12-01; deadline Jan 5", ref).map((d) => d.date.toISOString().slice(0, 10));
    expect(found).toEqual(["2026-10-14", "2026-11-03", "2026-12-01", "2027-01-05"]);
  });
  it("finds the first future date", () => {
    expect(firstFutureDate("Held on September 1, 2026, next on October 20, 2026", ref)?.text).toBe("October 20, 2026");
    expect(firstFutureDate("No dates here", ref)).toBeNull();
  });
  it("prefilter favours scheduled measurable events over opinion pieces", () => {
    expect(prefilterScore("Parliament to vote on budget on October 20, 2026", "The vote is expected to pass.", ref).score).toBeGreaterThan(0.6);
    expect(prefilterScore("Opinion: why we should care", "A column.", ref).score).toBeLessThan(0.1);
  });
});

describe("feeds", () => {
  it("parses RSS with CDATA, entities, relative links and tracking params", () => {
    const items = parseFeed(SAMPLE_RSS, "https://news.example.com/feed.xml");
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe("Central bank to announce rate decision on December 10, 2099");
    expect(items[0].summary).toBe("The committee meets & decides.");
    expect(items[0].publishedAt).toBe("2026-09-29T10:00:00.000Z");
    expect(items[1].url).toBe("https://news.example.com/relative/link");
  });
  it("parses Atom feeds", () => {
    const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Launch set for March 3, 2099</title><link rel="alternate" href="https://x.example/a"/><updated>2026-09-01T00:00:00Z</updated><summary>Rocket.</summary></entry></feed>`;
    expect(parseFeed(atom, "https://x.example")[0]).toMatchObject({ url: "https://x.example/a", summary: "Rocket." });
  });
  it("rejects non-XML and unknown formats with typed errors", () => {
    expect(() => parseFeed("<html><body>hi</body></html>", "https://x")).toThrow(/Unrecognised feed/);
    expect(() => parseFeed("{json}", "https://x")).toThrow(/not XML/);
  });
  it("canonicalises URLs so the same article hashes identically", () => {
    expect(canonicalUrl("http://www.Example.com/a/?utm_source=x&b=2&a=1#frag")).toBe("https://example.com/a?a=1&b=2");
    expect(urlHash("https://example.com/a?utm_medium=rss")).toBe(urlHash("https://www.example.com/a/"));
  });
});

describe("normalizeDraft", () => {
  it("fills binary outcomes, derives a close date and cleans the event key", () => {
    const n = normalizeDraft({
      suitable: true, unsuitableReason: null, eventSummary: "", eventKey: "Fed FOMC!! 2026", question: " Will X happen? ", category: "Economics",
      description: "", outcomeType: "binary", outcomes: [], eventDate: "2026-10-28T18:00:00.000Z", closeDate: null, resolutionCriteria: "",
      resolutionSourceName: "", resolutionSourceUrl: "javascript:alert(1)", tags: ["A", "a"], facts: { keyClaims: [] }, ambiguityNotes: [], confidence: 0.8, rationale: "",
    });
    expect(n.outcomes).toEqual([{ label: "Yes" }, { label: "No" }]);
    expect(n.closeDate).toBe("2026-10-28T17:00:00.000Z");
    expect(n.eventKey).toBe("fed-fomc-2026");
    expect(n.resolutionSourceUrl).toBe("");
    expect(n.tags).toEqual(["a"]);
  });
});
