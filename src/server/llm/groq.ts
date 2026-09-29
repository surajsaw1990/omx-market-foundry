/**
 * Groq chat-completions client (OpenAI-compatible API) and the LLM-backed analyzer.
 *
 * Failure handling:
 *  - 429 / 5xx / timeout on the primary model → one retry (honouring short Retry-After), then the
 *    fallback model (separate free-tier quota).
 *  - Output that is not valid JSON or fails schema validation → one "repair" round trip that sends
 *    the validation errors back to the model; if that also fails the item is marked `failed` and can
 *    be retried from the UI. We never silently create a candidate from unparseable output.
 */
import { config } from "../config";
import { logger } from "../logger";
import { PROMPT_VERSION, systemPrompt, userPrompt } from "./prompts";
import { analysisDraftSchema, LlmError, type AnalysisInput, type AnalysisResult, type Analyzer } from "./types";

type FetchFn = typeof fetch;

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GroqOptions {
  apiKey: string;
  baseUrl?: string;
  model: string;
  fallbackModel?: string;
  timeoutMs?: number;
  fetchImpl?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
}

export class GroqClient {
  private readonly fetchImpl: FetchFn;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: GroqOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private async call(model: string, messages: ChatMessage[]): Promise<string> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.opts.baseUrl ?? "https://api.groq.com/openai/v1"}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.opts.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.2,
          max_completion_tokens: 1400,
          response_format: { type: "json_object" },
        }),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 25_000),
      });
    } catch (err) {
      const e = err as Error;
      if (e.name === "TimeoutError" || e.name === "AbortError") throw new LlmError(`Groq request timed out (${model})`, "timeout", true);
      throw new LlmError(`Groq network error: ${e.message}`, "unavailable", true);
    }
    if (res.status === 401 || res.status === 403) throw new LlmError("Groq rejected the API key", "auth", false);
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") ?? "0");
      const err = new LlmError(`Groq rate limit reached for ${model}`, "rate_limited", true);
      (err as LlmError & { retryAfter?: number }).retryAfter = Number.isFinite(retryAfter) ? retryAfter : 0;
      throw err;
    }
    if (res.status === 400) {
      const body = await res.text();
      // json_object mode returns 400 "json_validate_failed" when the model emits invalid JSON.
      if (body.includes("json_validate_failed")) throw new LlmError("Model produced invalid JSON", "invalid_output", true);
      throw new LlmError(`Groq 400: ${body.slice(0, 200)}`, "unavailable", false);
    }
    if (!res.ok) throw new LlmError(`Groq HTTP ${res.status}`, "unavailable", res.status >= 500);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new LlmError("Groq returned an empty completion", "invalid_output", true);
    return content;
  }

  /** Calls the primary model with one retry, then the fallback model. Returns content + model used. */
  async complete(messages: ChatMessage[]): Promise<{ content: string; model: string }> {
    const models = [this.opts.model, this.opts.fallbackModel].filter((m, i, a): m is string => !!m && a.indexOf(m) === i);
    let lastErr: unknown;
    for (const model of models) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const content = await this.call(model, messages);
          return { content, model };
        } catch (err) {
          lastErr = err;
          const e = err as LlmError & { retryAfter?: number };
          if (!(e instanceof LlmError) || !e.retryable) throw err;
          logger.warn("llm.call_failed", { model, attempt, kind: e.kind, message: e.message });
          if (e.kind === "rate_limited" && (e.retryAfter ?? 0) > 5) break; // long wait: switch model now
          if (attempt === 0) await this.sleep(e.kind === "rate_limited" ? Math.max(1000, (e.retryAfter ?? 1) * 1000) : 600);
        }
      }
    }
    throw lastErr instanceof Error ? lastErr : new LlmError("Groq unavailable", "unavailable", true);
  }
}

function extractJson(content: string): unknown {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new LlmError("Model output is not JSON", "invalid_output", true);
  }
}

export class GroqAnalyzer implements Analyzer {
  readonly name = "groq";
  constructor(private readonly client: GroqClient) {}

  async analyze(input: AnalysisInput, now: Date): Promise<AnalysisResult> {
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt(now) },
      { role: "user", content: userPrompt(input) },
    ];
    for (let round = 0; round < 2; round++) {
      let content: string;
      let model: string;
      try {
        ({ content, model } = await this.client.complete(messages));
      } catch (err) {
        if (err instanceof LlmError && err.kind === "invalid_output" && round === 0) {
          messages.push({ role: "user", content: "Your previous reply was not valid JSON. Reply again with only the JSON object." });
          continue;
        }
        throw err;
      }
      let problem: string;
      try {
        const parsed = analysisDraftSchema.safeParse(extractJson(content));
        if (parsed.success) {
          return { draft: parsed.data, generator: `groq:${model}@${PROMPT_VERSION}` };
        }
        problem = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      } catch (err) {
        problem = (err as Error).message;
      }
      logger.warn("llm.invalid_output", { round, problem: problem.slice(0, 300) });
      messages.push({ role: "assistant", content });
      messages.push({ role: "user", content: `That JSON did not match the required schema (${problem}). Return the corrected JSON object only.` });
    }
    throw new LlmError("Model output failed schema validation twice", "invalid_output", true);
  }
}

export function createGroqAnalyzer(fetchImpl?: FetchFn): GroqAnalyzer {
  return new GroqAnalyzer(
    new GroqClient({
      apiKey: config.groqApiKey,
      baseUrl: config.groqBaseUrl,
      model: config.groqModel,
      fallbackModel: config.groqFallbackModel,
      timeoutMs: config.llmTimeoutMs,
      fetchImpl,
    }),
  );
}
