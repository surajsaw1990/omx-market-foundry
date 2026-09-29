import { api } from "@/server/http/handler";
import { createMarketFromCandidate } from "@/server/workflow/createMarket";

/** POST — create the OmniMarketX market for an approved candidate (idempotent). */
export const POST = api<{ id: string }>(async ({ db, actor }, { id }) => {
  const { market, replay } = await createMarketFromCandidate(db, id, actor);
  return Response.json({ market, replay }, { status: replay ? 200 : 201 });
});
