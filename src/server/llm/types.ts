import { z } from "zod";
import { CATEGORIES, type Category, type ReliabilityTier } from "@/lib/domain";

export interface AnalysisInput {
  title: string;
  summary: string;
  url: string;
  sourceName: string;
  sourceReliability: ReliabilityTier;
  publishedAt: string | null;
  categoryHint: Category | null;
  /** Other articles about the same story found in this run (extra context). */
  related?: { title: string; summary: string; url: string; sourceName: string }[];
}

const nullableString = z.preprocess((v) => (v === undefined ? null : v), z.string().nullable());

const lenientDate = z.preprocess((v) => {
  if (typeof v !== "string" || !v.trim()) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}, z.string().nullable());

const outcomeList = z.preprocess(
  (v) => (Array.isArray(v) ? v.map((o) => (typeof o === "string" ? { label: o } : o)) : v),
  z.array(z.object({ label: z.string().min(1), description: z.string().optional().nullable() })),
);

/** Schema for analyzer output. Lenient where LLMs are sloppy, strict where it matters. */
export const analysisDraftSchema = z.object({
  suitable: z.boolean(),
  unsuitableReason: nullableString.optional(),
  eventSummary: z.string().default(""),
  eventKey: z.string().default(""),
  question: z.string().default(""),
  category: z.preprocess(
    (v) => (typeof v === "string" && (CATEGORIES as readonly string[]).includes(v) ? v : "Other"),
    z.enum(CATEGORIES),
  ),
  description: z.string().default(""),
  outcomeType: z.preprocess((v) => (v === "multiple" || v === "categorical" ? "multiple" : "binary"), z.enum(["binary", "multiple"])),
  outcomes: outcomeList.default([]),
  eventDate: lenientDate.optional(),
  closeDate: lenientDate.optional(),
  resolutionCriteria: z.string().default(""),
  resolutionSourceName: z.string().default(""),
  resolutionSourceUrl: z.string().default(""),
  tags: z.array(z.string()).default([]),
  facts: z
    .object({ eventDate: lenientDate.optional(), keyClaims: z.array(z.string()).default([]) })
    .default({ keyClaims: [] }),
  ambiguityNotes: z.array(z.string()).default([]),
  confidence: z.preprocess((v) => (typeof v === "number" ? Math.max(0, Math.min(1, v > 1 ? v / 100 : v)) : 0.5), z.number()),
  rationale: z.string().default(""),
});
export type AnalysisDraft = z.infer<typeof analysisDraftSchema>;

export interface AnalysisResult {
  draft: AnalysisDraft;
  generator: string;
}

export interface Analyzer {
  readonly name: string;
  analyze(input: AnalysisInput, now: Date): Promise<AnalysisResult>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    public readonly kind: "rate_limited" | "unavailable" | "invalid_output" | "auth" | "timeout",
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "LlmError";
  }
}
