import { activeAnalyzer } from "../config";
import { createGroqAnalyzer } from "./groq";
import { HeuristicAnalyzer } from "./heuristic";
import type { Analyzer } from "./types";

export function createAnalyzer(): Analyzer {
  return activeAnalyzer() === "groq" ? createGroqAnalyzer() : new HeuristicAnalyzer();
}

export { HeuristicAnalyzer } from "./heuristic";
export type { Analyzer, AnalysisDraft, AnalysisInput, AnalysisResult } from "./types";
export { LlmError } from "./types";
