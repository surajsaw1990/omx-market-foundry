/** Centralised, typed runtime configuration. Read once; everything else imports `config`. */
import { logger } from "./logger";

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && value !== undefined && value !== "" ? n : fallback;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

const env = process.env;
const isProd = env.NODE_ENV === "production";

let sessionSecret = env.SESSION_SECRET ?? "";
if (sessionSecret.length < 16) {
  if (isProd && env.SESSION_SECRET) logger.warn("config.session_secret_too_short");
  // Deterministic fallback keeps demo deployments working; set SESSION_SECRET in real deployments.
  sessionSecret = `omx-dev-secret::${env.REVIEWER_ACCESS_CODE ?? "omx-review"}::change-me`;
}

export const config = {
  isProd,
  databaseUrl: env.DATABASE_URL || env.POSTGRES_URL || "",
  /** PGlite data directory when no DATABASE_URL: a path, or "memory". */
  pgliteDir: env.PGLITE_DATA_DIR || (env.VERCEL ? "memory" : ".data/pglite"),

  llmProvider: (env.LLM_PROVIDER || "auto") as "auto" | "groq" | "heuristic",
  groqApiKey: env.GROQ_API_KEY || "",
  groqBaseUrl: env.GROQ_BASE_URL || "https://api.groq.com/openai/v1",
  groqModel: env.GROQ_MODEL || "llama-3.3-70b-versatile",
  groqFallbackModel: env.GROQ_FALLBACK_MODEL || "llama-3.1-8b-instant",
  llmTimeoutMs: num(env.LLM_TIMEOUT_MS, 25_000),

  maxItemsPerRun: num(env.DISCOVERY_MAX_ITEMS_PER_RUN, 8),
  maxItemsPerSource: num(env.DISCOVERY_MAX_ITEMS_PER_SOURCE, 25),
  prefilterThreshold: num(env.DISCOVERY_PREFILTER_THRESHOLD, 0.3),
  discoveryCooldownSec: num(env.DISCOVERY_COOLDOWN_SECONDS, 20),
  sourceTimeoutMs: num(env.SOURCE_TIMEOUT_MS, 8_000),

  sessionSecret,
  reviewerAccessCode: env.REVIEWER_ACCESS_CODE || "omx-review",
  /** Show the access code on the login screen (public demo deployments). */
  showDemoCode: bool(env.SHOW_DEMO_ACCESS_CODE, true),

  omxApiUrl: env.OMX_API_URL || "",
  omxApiKey: env.OMX_API_KEY || "mock-omx-key",
  cronSecret: env.CRON_SECRET || "",
};

export function activeAnalyzer(): "groq" | "heuristic" {
  if (config.llmProvider === "heuristic") return "heuristic";
  if (config.llmProvider === "groq") return "groq";
  return config.groqApiKey ? "groq" : "heuristic";
}
