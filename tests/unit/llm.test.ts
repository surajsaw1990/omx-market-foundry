import { describe, expect, it, vi } from "vitest";
import { GroqAnalyzer, GroqClient } from "@/server/llm/groq";
import { HeuristicAnalyzer } from "@/server/llm/heuristic";
import { LlmError, type AnalysisInput } from "@/server/llm/types";
import { signSession, verifySession } from "@/server/auth/session";

const INPUT: AnalysisInput = {
  title: "Parliament to vote on budget on October 20, 2026",
  summary: "The vote is expected to pass.",
  url: "https://news.example.com/a",
  sourceName: "Example",
  sourceReliability: "major_media",
  publishedAt: "2026-09-29T00:00:00Z",
  categoryHint: null,
};
const NOW = new Date("2026-09-29T12:00:00Z");

const VALID = {
  suitable: true,
  eventKey: "parliament-budget-vote-2026-10",
  question: "Will Parliament pass the budget on October 20, 2026?",
  category: "Politics",
  description: "d",
  outcomeType: "binary",
  outcomes: ["Yes", "No"],
  eventDate: "2026-10-20T17:00:00Z",
  closeDate: "2026-10-20T08:00:00Z",
  resolutionCriteria: "c",
  resolutionSourceName: "Parliament",
  resolutionSourceUrl: "https://parliament.uk",
  confidence: 82,
};

function completion(content: string, status = 200, headers: Record<string, string> = {}) {
  return new Response(status === 200 ? JSON.stringify({ choices: [{ message: { content } }] }) : content, { status, headers });
}

function analyzer(responses: (() => Response)[]) {
  const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    (fetchImpl as unknown as { bodies: unknown[] }).bodies.push(JSON.parse(String(init?.body)));
    return next();
  });
  (fetchImpl as unknown as { bodies: unknown[] }).bodies = [];
  const client = new GroqClient({ apiKey: "k", model: "primary", fallbackModel: "fallback", fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => undefined });
  return { a: new GroqAnalyzer(client), fetchImpl, bodies: () => (fetchImpl as unknown as { bodies: { model: string }[] }).bodies };
}

describe("GroqAnalyzer", () => {
  it("parses a valid JSON-mode response and normalises lenient fields", async () => {
    const { a, bodies } = analyzer([() => completion(JSON.stringify(VALID))]);
    const r = await a.analyze(INPUT, NOW);
    expect(r.generator).toMatch(/^groq:primary@/);
    expect(r.draft.outcomes).toEqual([{ label: "Yes" }, { label: "No" }]);
    expect(r.draft.confidence).toBe(0.82);
    expect(bodies()[0]).toMatchObject({ model: "primary", response_format: { type: "json_object" } });
  });

  it("sends schema errors back to the model once and accepts the repaired answer", async () => {
    const { a, bodies } = analyzer([() => completion(JSON.stringify({ question: "missing suitable" })), () => completion(JSON.stringify(VALID))]);
    const r = await a.analyze(INPUT, NOW);
    expect(r.draft.suitable).toBe(true);
    expect(JSON.stringify(bodies()[1])).toContain("did not match the required schema");
  });

  it("fails loudly after two invalid answers instead of inventing a candidate", async () => {
    const { a } = analyzer([() => completion("not json at all"), () => completion("still not json")]);
    await expect(a.analyze(INPUT, NOW)).rejects.toMatchObject({ kind: "invalid_output" });
  });

  it("falls back to the secondary model when the primary is rate limited", async () => {
    const { a, bodies } = analyzer([() => completion("{}", 429, { "retry-after": "30" }), () => completion(JSON.stringify(VALID))]);
    const r = await a.analyze(INPUT, NOW);
    expect(r.generator).toMatch(/^groq:fallback@/);
    expect(bodies().map((b) => b.model)).toEqual(["primary", "fallback"]);
  });

  it("does not retry on an invalid API key", async () => {
    const { a, fetchImpl } = analyzer([() => completion("{}", 401)]);
    await expect(a.analyze(INPUT, NOW)).rejects.toBeInstanceOf(LlmError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("HeuristicAnalyzer", () => {
  const h = new HeuristicAnalyzer();
  it("drafts a dated question from a scheduled-action headline", async () => {
    const { draft } = await h.analyze(INPUT, NOW);
    expect(draft.suitable).toBe(true);
    expect(draft.question).toBe("Will Parliament vote on budget by October 20, 2026?");
    expect(Date.parse(draft.closeDate!)).toBeLessThanOrEqual(Date.parse(draft.eventDate!));
    expect(draft.confidence).toBeLessThan(0.5);
  });
  it("rejects opinion pieces and undated items", async () => {
    expect((await h.analyze({ ...INPUT, title: "Opinion: budgets are bad" }, NOW)).draft.suitable).toBe(false);
    expect((await h.analyze({ ...INPUT, title: "Parliament debates budget", summary: "No date." }, NOW)).draft.suitable).toBe(false);
  });
  it("builds price-threshold questions", async () => {
    const { draft } = await h.analyze({ ...INPUT, title: "Bitcoin climbs toward $150,000", summary: "Traders eye a close above $150,000 on October 31, 2026." }, NOW);
    expect(draft.question).toBe("Will Bitcoin close above $150,000 on October 31, 2026?");
  });
});

describe("sessions", () => {
  it("round-trips, rejects tampering and expiry", async () => {
    const token = await signSession({ name: "A", role: "reviewer", exp: 2_000_000_000 }, "secret-secret-secret");
    expect(await verifySession(token, "secret-secret-secret", 1_900_000_000)).toMatchObject({ name: "A" });
    expect(await verifySession(token, "other-secret-secret", 1_900_000_000)).toBeNull();
    expect(await verifySession(token.replace(/^./, "x"), "secret-secret-secret", 1_900_000_000)).toBeNull();
    expect(await verifySession(token, "secret-secret-secret", 2_100_000_000)).toBeNull();
  });
});
