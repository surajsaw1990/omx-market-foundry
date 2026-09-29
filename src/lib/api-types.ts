import type { AuditEvent, Candidate, CandidateSourceLink, DiscoveryRun, Market, Revision, SimilarItem, Source, SourceItem } from "./domain";

export interface SystemInfo {
  analyzer: "groq" | "heuristic";
  model: string | null;
  fallbackModel: string | null;
  database: "postgres" | "pglite";
  maxItemsPerRun: number;
  publisher: string;
}

export interface OverviewResponse {
  candidates: Record<string, number>;
  items: Record<string, number>;
  marketsCreated: number;
  runs: DiscoveryRun[];
  sources: Source[];
  attention: Candidate[];
  activity: AuditEvent[];
  system: SystemInfo;
}

export interface CandidateListResponse {
  candidates: Candidate[];
  counts: Record<string, number>;
}

export interface CandidateDetailResponse {
  candidate: Candidate;
  sources: CandidateSourceLink[];
  similar: SimilarItem[];
  revisions: Revision[];
  activity: AuditEvent[];
  market: Market | null;
  analyses: { id: string; analysis: { draft: Record<string, unknown>; generator: string } }[];
}

export interface RunDetailResponse {
  run: DiscoveryRun;
  items: SourceItem[];
}

export interface MeResponse {
  user: { name: string; role: string } | null;
  demoAccessCode: string | null;
}
