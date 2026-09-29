import { api } from "@/server/http/handler";
import { listMarkets } from "@/server/repositories/others";

export const dynamic = "force-dynamic";

export const GET = api(async ({ db }) => Response.json({ markets: await listMarkets(db) }));
