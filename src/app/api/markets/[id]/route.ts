import { notFound } from "@/server/http/errors";
import { api } from "@/server/http/handler";
import { getMarket, listAudit } from "@/server/repositories/others";

export const dynamic = "force-dynamic";

export const GET = api<{ id: string }>(async ({ db }, { id }) => {
  const market = await getMarket(db, id);
  if (!market) throw notFound("Market");
  const activity = market.candidateId ? await listAudit(db, { entityType: "candidate", entityId: market.candidateId, limit: 50 }) : [];
  return Response.json({ market, activity });
});
