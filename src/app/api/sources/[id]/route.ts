import { sourceUpdateSchema } from "@/lib/domain";
import { notFound } from "@/server/http/errors";
import { api, readJson } from "@/server/http/handler";
import { audit, deleteSource, getSource, updateSource } from "@/server/repositories/others";

export const PATCH = api<{ id: string }>(async ({ req, db, actor }, { id }) => {
  const body = sourceUpdateSchema.parse(await readJson(req));
  if (!(await getSource(db, id))) throw notFound("Source");
  await updateSource(db, id, body);
  await audit(db, { entityType: "source", entityId: id, action: "updated", actor, details: body });
  return Response.json({ source: await getSource(db, id) });
});

export const DELETE = api<{ id: string }>(async ({ db, actor }, { id }) => {
  if (!(await getSource(db, id))) throw notFound("Source");
  await deleteSource(db, id);
  await audit(db, { entityType: "source", entityId: id, action: "deleted", actor });
  return Response.json({ ok: true });
});
