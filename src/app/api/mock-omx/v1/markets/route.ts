/**
 * Mock OmniMarketX Market API.
 *   POST /api/mock-omx/v1/markets
 *   Headers: x-api-key: <OMX_API_KEY>, Idempotency-Key: <unique key>
 *   Body:    OmxMarketPayload (see src/lib/domain.ts / docs/API.md)
 *   201 → { market } (created) · 200 → { market } (idempotent replay) · 401 · 400 · 422 · 503
 */
import { config } from "@/server/config";
import { AppError } from "@/server/http/errors";
import { api, readJson } from "@/server/http/handler";
import { mockCreateMarket } from "@/server/markets/mockOmx";

export const POST = api(
  async ({ req, db }) => {
    if (req.headers.get("x-api-key") !== config.omxApiKey) throw new AppError(401, "INVALID_API_KEY", "Missing or invalid x-api-key.");
    const market = await mockCreateMarket(db, await readJson(req), req.headers.get("idempotency-key"));
    return Response.json({ market }, { status: market.idempotentReplay ? 200 : 201 });
  },
  { auth: false },
);
