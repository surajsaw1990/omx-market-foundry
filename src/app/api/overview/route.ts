import { activeAnalyzer, config } from "@/server/config";
import { api } from "@/server/http/handler";
import { countByStatus, listCandidates } from "@/server/repositories/candidates";
import { countItemsByStatus, listAudit, listRuns, listSources } from "@/server/repositories/others";

export const dynamic = "force-dynamic";

export const GET = api(async ({ db }) => {
  const [candidates, items, runs, sources, attention, activity, markets] = await Promise.all([
    countByStatus(db),
    countItemsByStatus(db),
    listRuns(db, 6),
    listSources(db),
    listCandidates(db, { status: "pending_review", sort: "score", limit: 6 }),
    listAudit(db, { limit: 12 }),
    db.query<{ n: number }>("SELECT count(*)::int AS n FROM markets WHERE NOT is_seed"),
  ]);
  return Response.json({
    candidates,
    items,
    marketsCreated: Number(markets.rows[0]?.n ?? 0),
    runs,
    sources,
    attention,
    activity,
    system: {
      analyzer: activeAnalyzer(),
      model: activeAnalyzer() === "groq" ? config.groqModel : null,
      fallbackModel: activeAnalyzer() === "groq" ? config.groqFallbackModel : null,
      database: db.kind,
      maxItemsPerRun: config.maxItemsPerRun,
      publisher: config.omxApiUrl ? "http" : "in-process-mock",
    },
  });
});
