import { config } from "@/server/config";
import { AppError, notFound } from "@/server/http/errors";
import { api } from "@/server/http/handler";
import { mockGetMarket } from "@/server/markets/mockOmx";

export const dynamic = "force-dynamic";

export const GET = api<{ id: string }>(
  async ({ req, db }, { id }) => {
    if (req.headers.get("x-api-key") !== config.omxApiKey) throw new AppError(401, "INVALID_API_KEY", "Missing or invalid x-api-key.");
    const market = await mockGetMarket(db, id);
    if (!market) throw notFound("Market");
    return Response.json({ market });
  },
  { auth: false },
);
