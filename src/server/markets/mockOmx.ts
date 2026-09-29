/**
 * Mock OmniMarketX Market API — the stand-in for the production market service.
 * Exposed over HTTP at POST /api/mock-omx/v1/markets and also callable in-process.
 *
 * Contract:
 *  - `x-api-key` must match OMX_API_KEY.
 *  - `Idempotency-Key` is required; replaying a key returns the originally created market (200)
 *    instead of creating a second one (201).
 *  - Payload is validated against `omxMarketPayloadSchema` (422 on failure).
 */
import { omxMarketPayloadSchema, type OmxMarketPayload } from "@/lib/domain";
import type { Queryable } from "../db/client";
import { AppError } from "../http/errors";
import { newId } from "../ids";

export interface OmxMarketRecord {
  id: string;
  url: string;
  status: "scheduled" | "open";
  slug: string;
  createdAt: string;
  idempotentReplay: boolean;
}

export async function mockCreateMarket(q: Queryable, body: unknown, idempotencyKey: string | null): Promise<OmxMarketRecord> {
  if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 200) {
    throw new AppError(400, "IDEMPOTENCY_KEY_REQUIRED", "An Idempotency-Key header (8-200 chars) is required.");
  }
  const failureRate = Number(process.env.MOCK_OMX_FAILURE_RATE ?? "0");
  if (failureRate > 0 && Math.random() < failureRate) {
    throw new AppError(503, "UPSTREAM_UNAVAILABLE", "Mock OmniMarketX API is temporarily unavailable (simulated).");
  }

  const existing = await q.query<{ id: string; payload: OmxMarketPayload; status: string; created_at: Date | string }>(
    "SELECT id, payload, status, created_at FROM omx_markets WHERE idempotency_key = $1",
    [idempotencyKey],
  );
  if (existing.rows[0]) {
    const r = existing.rows[0];
    const payload = typeof r.payload === "string" ? (JSON.parse(r.payload) as OmxMarketPayload) : r.payload;
    return { id: r.id, url: marketUrl(r.id), status: r.status as OmxMarketRecord["status"], slug: payload.slug, createdAt: new Date(r.created_at).toISOString(), idempotentReplay: true };
  }

  const parsed = omxMarketPayloadSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError(422, "INVALID_MARKET", "Market payload failed validation.", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  const payload = parsed.data;
  if (Date.parse(payload.closesAt) <= Date.now()) {
    throw new AppError(422, "INVALID_MARKET", "closesAt must be in the future.");
  }
  if (payload.expectedResolutionAt && Date.parse(payload.closesAt) > Date.parse(payload.expectedResolutionAt)) {
    throw new AppError(422, "INVALID_MARKET", "closesAt must not be after expectedResolutionAt.");
  }

  const id = newId("omx_mkt");
  const inserted = await q.query<{ id: string; created_at: Date | string }>(
    `INSERT INTO omx_markets (id, idempotency_key, payload, status) VALUES ($1,$2,$3::jsonb,'scheduled')
     ON CONFLICT (idempotency_key) DO NOTHING RETURNING id, created_at`,
    [id, idempotencyKey, JSON.stringify(payload)],
  );
  if (!inserted.rows[0]) {
    // Lost a race with a concurrent request using the same key: return the winner.
    return mockCreateMarket(q, body, idempotencyKey);
  }
  return { id, url: marketUrl(id), status: "scheduled", slug: payload.slug, createdAt: new Date(inserted.rows[0].created_at).toISOString(), idempotentReplay: false };
}

function marketUrl(id: string) {
  return `https://omnimarketx.example/markets/${id}`;
}

export async function mockGetMarket(q: Queryable, id: string) {
  const { rows } = await q.query("SELECT id, payload, status, created_at FROM omx_markets WHERE id = $1", [id]);
  return rows[0] ?? null;
}
