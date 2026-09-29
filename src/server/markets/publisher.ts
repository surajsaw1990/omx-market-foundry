/**
 * Service boundary between this tool and the OmniMarketX market service.
 * - `InProcessMockPublisher` (default) calls the mock API logic directly against our database.
 * - `HttpOmxPublisher` (when OMX_API_URL is set) calls a real HTTP endpoint — point it at
 *   `<deployment>/api/mock-omx` to exercise the full HTTP contract, or at a production service.
 */
import type { OmxMarketPayload } from "@/lib/domain";
import { config } from "../config";
import type { Queryable } from "../db/client";
import { AppError } from "../http/errors";
import { mockCreateMarket, type OmxMarketRecord } from "./mockOmx";

export interface MarketPublisher {
  readonly name: string;
  createMarket(payload: OmxMarketPayload, idempotencyKey: string): Promise<OmxMarketRecord>;
}

export class InProcessMockPublisher implements MarketPublisher {
  readonly name = "mock-omx:in-process";
  constructor(private readonly q: Queryable) {}
  createMarket(payload: OmxMarketPayload, idempotencyKey: string) {
    return mockCreateMarket(this.q, payload, idempotencyKey);
  }
}

export class HttpOmxPublisher implements MarketPublisher {
  readonly name = "omx:http";
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async createMarket(payload: OmxMarketPayload, idempotencyKey: string): Promise<OmxMarketRecord> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}/v1/markets`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": this.apiKey, "Idempotency-Key": idempotencyKey },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new AppError(502, "UPSTREAM_UNAVAILABLE", `Market service unreachable: ${(err as Error).message}`);
    }
    const body = (await res.json().catch(() => null)) as { market?: OmxMarketRecord; error?: { code: string; message: string; details?: unknown } } | null;
    if (!res.ok || !body?.market) {
      const status = res.status >= 500 ? 502 : res.status;
      throw new AppError(status, body?.error?.code ?? "UPSTREAM_ERROR", body?.error?.message ?? `Market service returned HTTP ${res.status}`, body?.error?.details);
    }
    return body.market;
  }
}

export function createPublisher(q: Queryable): MarketPublisher {
  return config.omxApiUrl ? new HttpOmxPublisher(config.omxApiUrl, config.omxApiKey) : new InProcessMockPublisher(q);
}
