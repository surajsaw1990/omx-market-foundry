import { describe, expect, it } from "vitest";
import type { CandidateEditInput } from "@/lib/domain";
import { isTrustedDomain, validateCandidate, type ValidationContext } from "@/lib/validation";

const NOW = new Date("2026-10-01T12:00:00Z");

function good(overrides: Partial<CandidateEditInput> = {}): CandidateEditInput {
  return {
    question: "Will the Federal Reserve lower the federal funds target range at its meeting concluding on October 28, 2026?",
    category: "Economics",
    description: "The FOMC meets on October 27–28, 2026. Markets are split between a hold and a 25bp cut.",
    outcomeType: "binary",
    outcomes: [{ label: "Yes" }, { label: "No" }],
    eventDate: "2026-10-28T18:00:00Z",
    closeDate: "2026-10-28T17:00:00Z",
    resolutionCriteria:
      "Resolves YES if the FOMC statement published on federalreserve.gov on October 28, 2026 (18:00 UTC) lowers the target range. If the meeting is postponed beyond October 31, 2026, resolves NO.",
    resolutionSourceName: "Federal Reserve",
    resolutionSourceUrl: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
    tags: ["fed"],
    ...overrides,
  };
}

const ctx = (extra: Partial<ValidationContext> = {}): ValidationContext => ({
  now: NOW,
  sources: [
    { url: "https://www.federalreserve.gov/a", publishedAt: "2026-09-30T00:00:00Z", reliability: "official", role: "primary", facts: { eventDate: "2026-10-28T18:00:00Z" }, sourceName: "Fed" },
    { url: "https://bbc.co.uk/b", publishedAt: "2026-09-30T00:00:00Z", reliability: "major_media", role: "supporting", facts: {}, sourceName: "BBC" },
  ],
  similar: [],
  ...extra,
});

const codes = (r: ReturnType<typeof validateCandidate>) => r.issues.map((i) => i.code);

describe("validateCandidate", () => {
  it("gives a clean, well-formed market a perfect score", () => {
    const r = validateCandidate(good(), ctx());
    expect(r.issues).toEqual([]);
    expect(r.score).toBe(100);
  });

  it("blocks subjective questions and warns on vague wording", () => {
    const r = validateCandidate(good({ question: "Will the Fed make a significant and successful decision by October 28, 2026?" }), ctx());
    expect(codes(r)).toContain("SUBJECTIVE_OUTCOME");
    expect(codes(r)).toContain("AMBIGUOUS_WORDING");
    expect(r.blockers).toBeGreaterThan(0);
  });

  it("does not treat 'on or before' as a compound condition", () => {
    expect(codes(validateCandidate(good({ question: "Will Starship launch on or before October 15, 2026?" }), ctx()))).not.toContain("COMPOUND_QUESTION");
    expect(codes(validateCandidate(good({ question: "Will Starship launch or explode by October 15, 2026?" }), ctx()))).toContain("COMPOUND_QUESTION");
  });

  it("requires a close date that is in the future and not after the event", () => {
    expect(codes(validateCandidate(good({ closeDate: null }), ctx()))).toContain("MISSING_CLOSE_DATE");
    expect(codes(validateCandidate(good({ closeDate: "2026-09-01T00:00:00Z" }), ctx()))).toContain("CLOSE_IN_PAST");
    expect(codes(validateCandidate(good({ closeDate: "2026-10-29T00:00:00Z" }), ctx()))).toContain("CLOSE_AFTER_EVENT");
  });

  it("flags missing / untrusted resolution sources and thin criteria", () => {
    expect(codes(validateCandidate(good({ resolutionSourceName: "", resolutionSourceUrl: "" }), ctx()))).toContain("NO_RESOLUTION_SOURCE");
    expect(codes(validateCandidate(good({ resolutionSourceUrl: "https://random-blog.example/post" }), ctx()))).toContain("UNVERIFIED_RESOLUTION_SOURCE");
    expect(codes(validateCandidate(good({ resolutionCriteria: "Resolves yes if it happens." }), ctx()))).toContain("WEAK_RESOLUTION_CRITERIA");
    expect(codes(validateCandidate(good({ resolutionCriteria: "Resolves YES if the statement lowers the range, as published on the official website in UTC." }), ctx()))).toContain("NO_EDGE_CASE_HANDLING");
  });

  it("validates outcome sets", () => {
    expect(codes(validateCandidate(good({ outcomes: [{ label: "Yes" }, { label: "yes" }] }), ctx()))).toContain("DUPLICATE_OUTCOMES");
    expect(codes(validateCandidate(good({ outcomeType: "multiple", outcomes: [{ label: "A" }, { label: "B" }, { label: "C" }] }), ctx()))).toContain("OUTCOMES_NOT_EXHAUSTIVE");
  });

  it("detects conflicting event dates between sources", () => {
    const r = validateCandidate(
      good(),
      ctx({
        sources: [
          { url: "https://a.example", publishedAt: "2026-09-30T00:00:00Z", reliability: "major_media", role: "primary", facts: { eventDate: "2026-10-08T00:00:00Z" }, sourceName: "A" },
          { url: "https://b.example", publishedAt: "2026-09-30T00:00:00Z", reliability: "major_media", role: "supporting", facts: { eventDate: "2026-10-15T00:00:00Z" }, sourceName: "B" },
        ],
      }),
    );
    expect(codes(r)).toContain("CONFLICTING_SOURCES");
  });

  it("blocks duplicates of live markets but only warns on duplicate candidates, ignoring rejected ones", () => {
    const sim = (kind: "market" | "candidate", status = "open") => ({ kind, id: "x", question: "q", status, similarity: 0.9 });
    expect(validateCandidate(good(), ctx({ similar: [sim("market")] })).issues.find((i) => i.code === "DUPLICATE_MARKET")?.severity).toBe("blocker");
    expect(validateCandidate(good(), ctx({ similar: [sim("candidate", "pending_review")] })).issues.find((i) => i.code === "DUPLICATE_CANDIDATE")?.severity).toBe("warning");
    expect(codes(validateCandidate(good(), ctx({ similar: [sim("candidate", "rejected")] })))).not.toContain("DUPLICATE_CANDIDATE");
  });

  it("surfaces evidence problems and analyzer uncertainty", () => {
    expect(codes(validateCandidate(good(), ctx({ sources: [] })))).toContain("NO_SUPPORTING_SOURCES");
    const r = validateCandidate(good(), ctx({ confidence: 0.3, ambiguityNotes: ["Date not confirmed"] }));
    expect(codes(r)).toEqual(expect.arrayContaining(["LOW_CONFIDENCE", "ANALYZER_AMBIGUITY"]));
  });

  it("scores deterministically and orders blockers first", () => {
    const r = validateCandidate(good({ closeDate: null, question: "Will it happen soon?" }), ctx());
    expect(r.issues[0].severity).toBe("blocker");
    expect(r.score).toBe(Math.max(0, 100 - r.blockers * 25 - r.warnings * 8 - (r.issues.length - r.blockers - r.warnings) * 2));
  });
});

describe("isTrustedDomain", () => {
  it("matches suffixes and exact domains", () => {
    expect(isTrustedDomain("https://www.federalreserve.gov/x")).toBe(true);
    expect(isTrustedDomain("https://www.ons.gov.uk/x")).toBe(true);
    expect(isTrustedDomain("https://feeds.bbci.co.uk.evil.com/x")).toBe(false);
    expect(isTrustedDomain("not a url")).toBe(false);
  });
});
