import { notFound } from "@/server/http/errors";
import { api } from "@/server/http/handler";
import { getRun, listItems } from "@/server/repositories/others";

export const dynamic = "force-dynamic";

export const GET = api<{ id: string }>(async ({ db }, { id }) => {
  const run = await getRun(db, id);
  if (!run) throw notFound("Run");
  return Response.json({ run, items: await listItems(db, { runId: id, limit: 500 }) });
});
