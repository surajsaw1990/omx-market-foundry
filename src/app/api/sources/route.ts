import { sourceCreateSchema } from "@/lib/domain";
import { api, readJson } from "@/server/http/handler";
import { audit, createSource, getSource, listSources } from "@/server/repositories/others";

export const dynamic = "force-dynamic";

export const GET = api(async ({ db }) => Response.json({ sources: await listSources(db) }));

export const POST = api(async ({ req, db, actor }) => {
  const body = sourceCreateSchema.parse(await readJson(req));
  const id = await createSource(db, { name: body.name, url: body.url, categoryHint: body.categoryHint ?? null, reliability: body.reliability });
  await audit(db, { entityType: "source", entityId: id, action: "created", actor, details: { url: body.url } });
  return Response.json({ source: await getSource(db, id) }, { status: 201 });
});
