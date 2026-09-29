import { reviewDecisionSchema } from "@/lib/domain";
import { api, readJson } from "@/server/http/handler";
import { approveCandidate } from "@/server/workflow/review";

export const POST = api<{ id: string }>(async ({ req, db, actor }, { id }) => {
  const body = reviewDecisionSchema.parse(await readJson(req));
  return Response.json({ candidate: await approveCandidate(db, id, body, actor) });
});
