import { activeAnalyzer, config } from "@/server/config";
import { api } from "@/server/http/handler";

export const dynamic = "force-dynamic";

export const GET = api(
  async ({ db }) => {
    const started = Date.now();
    await db.query("SELECT 1");
    return Response.json({
      ok: true,
      database: { kind: db.kind, latencyMs: Date.now() - started },
      analyzer: activeAnalyzer(),
      model: activeAnalyzer() === "groq" ? config.groqModel : null,
      publisher: config.omxApiUrl ? "http" : "in-process-mock",
    });
  },
  { auth: false },
);
