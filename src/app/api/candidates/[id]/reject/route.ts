import { rejectSchema } from "@/lib/domain";
import { api, readJson } from "@/server/http/handler";
import { rejectCandidate } from "@/server/workflow/review";

export const POST = api<{ id: string }>(async ({ req, db, actor }, { id }) => {
  const body = rejectSchema.parse(await readJson(req));
  return Response.json({ candidate: await rejectCandidate(db, id, body, actor) });
});
