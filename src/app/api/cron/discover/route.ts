/** Scheduled discovery (Vercel Cron). Requires `Authorization: Bearer $CRON_SECRET`. */
import { config } from "@/server/config";
import { runDiscovery } from "@/server/discovery/pipeline";
import { AppError } from "@/server/http/errors";
import { api } from "@/server/http/handler";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = api(
  async ({ req, db }) => {
    if (!config.cronSecret || req.headers.get("authorization") !== `Bearer ${config.cronSecret}`) {
      throw new AppError(401, "UNAUTHORIZED", "Invalid cron secret.");
    }
    const result = await runDiscovery({ db, trigger: "cron", actor: "system:cron", budgetMs: 45_000 });
    return Response.json(result);
  },
  { auth: false },
);
