import { requeueItem } from "@/server/discovery/pipeline";
import { api } from "@/server/http/handler";

export const POST = api<{ id: string }>(async ({ db, actor }, { id }) => {
  await requeueItem(db, id, actor);
  return Response.json({ ok: true });
});
