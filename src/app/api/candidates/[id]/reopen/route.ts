import { z } from "zod";
import { api, readJson } from "@/server/http/handler";
import { reopenCandidate } from "@/server/workflow/review";

const schema = z.object({ expectedVersion: z.number().int().positive() });

export const POST = api<{ id: string }>(async ({ req, db, actor }, { id }) => {
  const body = schema.parse(await readJson(req));
  return Response.json({ candidate: await reopenCandidate(db, id, body, actor) });
});
