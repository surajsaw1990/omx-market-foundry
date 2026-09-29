/**
 * Shared domain types and input schemas. Imported by both the server and the browser,
 * so this module must stay free of Node-only dependencies.
 */
import { z } from "zod";

export const CANDIDATE_STATUSES = ["pending_review", "approved", "rejected", "market_created"] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

export const STATUS_LABELS: Record<CandidateStatus, string> = {
  pending_review: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
  market_created: "Market created",
};

export const CATEGORIES = [
  "Politics",
  "Economics",
  "Finance",
  "Crypto",
  "Technology",
  "Science",
  "Sports",
  "Climate & Weather",
  "Business",
  "World",
  "Entertainment",
  "Other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const SOURCE_TYPES = ["rss", "fixture"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const RELIABILITY_TIERS = ["official", "major_media", "aggregator", "community", "synthetic"] as const;
export type ReliabilityTier = (typeof RELIABILITY_TIERS)[number];

export const ITEM_STATUSES = [
  "new", // stored, not yet processed
  "skipped", // filtered out by the cheap prefilter
  "unsuitable", // analysed, judged not to be a market
  "candidate", // produced a new candidate
  "merged", // attached to an existing candidate as extra evidence
  "clustered", // same story as another item in the same run
  "failed", // analysis failed (retryable)
] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export type Severity = "blocker" | "warning" | "info";

export interface ValidationIssue {
  code: string;
  severity: Severity;
  message: string;
  field?: string;
  hint?: string;
}

export interface ValidationReport {
  issues: ValidationIssue[];
  score: number; // 0..100
  blockers: number;
  warnings: number;
  checkedAt: string;
}

export interface Outcome {
  label: string;
  description?: string;
}

export interface Candidate {
  id: string;
  question: string;
  category: Category;
  description: string;
  outcomeType: "binary" | "multiple";
  outcomes: Outcome[];
  eventDate: string | null;
  closeDate: string | null;
  resolutionCriteria: string;
  resolutionSourceName: string;
  resolutionSourceUrl: string;
  tags: string[];
  eventKey: string;
  status: CandidateStatus;
  confidence: number | null;
  aiRationale: string;
  ambiguityNotes: string[];
  generator: string;
  validation: ValidationReport;
  version: number;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  sourceCount: number;
  marketId: string | null;
}

export interface SourceFacts {
  eventDate?: string | null;
  keyClaims?: string[];
}

export interface CandidateSourceLink {
  itemId: string;
  role: "primary" | "supporting" | "conflicting";
  facts: SourceFacts;
  addedAt: string;
  title: string;
  url: string;
  summary: string;
  publishedAt: string | null;
  sourceName: string;
  sourceReliability: ReliabilityTier;
}

export interface Source {
  id: string;
  slug: string;
  name: string;
  type: SourceType;
  url: string;
  categoryHint: Category | null;
  reliability: ReliabilityTier;
  enabled: boolean;
  lastFetchedAt: string | null;
  lastStatus: "ok" | "error" | null;
  lastError: string | null;
  consecutiveFailures: number;
  itemCount: number;
  createdAt: string;
}

export interface SourceItem {
  id: string;
  sourceId: string;
  sourceName: string;
  runId: string | null;
  url: string;
  title: string;
  summary: string;
  publishedAt: string | null;
  fetchedAt: string;
  status: ItemStatus;
  prefilterScore: number;
  reason: string | null;
  candidateId: string | null;
}

export interface RunStats {
  sourcesOk: number;
  sourcesFailed: number;
  itemsFetched: number;
  itemsNew: number;
  itemsSkipped: number;
  itemsAnalyzed: number;
  itemsUnsuitable: number;
  itemsFailed: number;
  itemsClustered: number;
  candidatesCreated: number;
  candidatesMerged: number;
}

export interface RunLogEntry {
  at: string;
  level: "info" | "warn" | "error";
  message: string;
}

export interface DiscoveryRun {
  id: string;
  trigger: "manual" | "cron";
  triggeredBy: string;
  status: "running" | "completed" | "completed_with_errors" | "failed";
  analyzer: string;
  startedAt: string;
  finishedAt: string | null;
  stats: RunStats;
  log: RunLogEntry[];
  error: string | null;
}

export interface Market {
  id: string;
  candidateId: string;
  externalId: string;
  externalUrl: string;
  slug: string;
  question: string;
  category: string;
  status: string;
  payload: OmxMarketPayload;
  createdBy: string;
  createdAt: string;
  isSeed: boolean;
}

export interface AuditEvent {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  actor: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface Revision {
  id: string;
  candidateId: string;
  version: number;
  changedBy: string;
  changes: Record<string, { from: unknown; to: unknown }>;
  createdAt: string;
}

export interface SimilarItem {
  kind: "candidate" | "market";
  id: string;
  question: string;
  status: string;
  similarity: number;
}

/* ------------------------------------------------------------------ */
/* Input schemas (shared between the edit form and the API).           */
/* ------------------------------------------------------------------ */

const isoDate = z
  .string()
  .trim()
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: "Invalid date" })
  .transform((v) => new Date(v).toISOString());

export const outcomeSchema = z.object({
  label: z.string().trim().min(1, "Outcome label required").max(80),
  description: z.string().trim().max(300).optional(),
});

export const candidateEditSchema = z.object({
  question: z.string().trim().min(10, "Question is too short").max(300),
  category: z.enum(CATEGORIES),
  description: z.string().trim().max(3000),
  outcomeType: z.enum(["binary", "multiple"]),
  outcomes: z.array(outcomeSchema).min(1).max(12),
  eventDate: isoDate.nullable(),
  closeDate: isoDate.nullable(),
  resolutionCriteria: z.string().trim().max(3000),
  resolutionSourceName: z.string().trim().max(200),
  resolutionSourceUrl: z.union([z.literal(""), z.url({ message: "Must be a valid URL" })]),
  tags: z.array(z.string().trim().min(1).max(40)).max(10),
});
export type CandidateEditInput = z.infer<typeof candidateEditSchema>;

export const candidateUpdateRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
  changes: candidateEditSchema.partial(),
});

export const reviewDecisionSchema = z.object({
  expectedVersion: z.number().int().positive(),
  note: z.string().trim().max(1000).optional(),
  acknowledgeWarnings: z.boolean().optional(),
});

export const rejectSchema = z.object({
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(3, "Please give a reason").max(1000),
});

export const sourceCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  url: z.url(),
  categoryHint: z.enum(CATEGORIES).nullable().optional(),
  reliability: z.enum(RELIABILITY_TIERS).default("major_media"),
});

export const sourceUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  name: z.string().trim().min(2).max(120).optional(),
  categoryHint: z.enum(CATEGORIES).nullable().optional(),
  reliability: z.enum(RELIABILITY_TIERS).optional(),
});

/* ------------------------------------------------------------------ */
/* Market payload: the contract with the (mock) OmniMarketX API.       */
/* ------------------------------------------------------------------ */

export const omxMarketPayloadSchema = z.object({
  title: z.string().min(10).max(300),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  description: z.string().max(5000),
  category: z.string().min(1),
  marketType: z.enum(["binary", "categorical"]),
  outcomes: z.array(z.object({ id: z.string(), label: z.string() })).min(2),
  closesAt: z.string().datetime(),
  expectedResolutionAt: z.string().datetime().nullable(),
  resolution: z.object({
    criteria: z.string().min(20),
    source: z.object({ name: z.string().min(1), url: z.string() }),
  }),
  tags: z.array(z.string()),
  provenance: z.object({
    candidateId: z.string(),
    candidateVersion: z.number(),
    generator: z.string(),
    approvedBy: z.string(),
    approvedAt: z.string(),
    sources: z.array(
      z.object({ title: z.string(), url: z.string(), publisher: z.string(), publishedAt: z.string().nullable() }),
    ),
  }),
});
export type OmxMarketPayload = z.infer<typeof omxMarketPayloadSchema>;

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
