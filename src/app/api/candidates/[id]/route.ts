import { candidateUpdateRequestSchema } from "@/lib/domain";
import { notFound } from "@/server/http/errors";
import { api, readJson } from "@/server/http/handler";
import { getCandidate, listCandidateSources, listRevisions, refreshValidation } from "@/server/repositories/candidates";
import { getMarketByCandidate, listAudit } from "@/server/repositories/others";
import { validateWithContext } from "@/server/workflow/context";
import { editCandidate } from "@/server/workflow/review";

export const dynamic = "force-dynamic";

/** Candidate detail with a freshly computed validation report (dates and duplicates change over time). */
export const GET = api<{ id: string }>(async ({ db }, { id }) => {
  let candidate = await getCandidate(db, id);
  if (!candidate) throw notFound("Candidate");
  const { report, similar } = await validateWithContext(db, candidate);
  if (candidate.status !== "market_created" && JSON.stringify(report.issues) !== JSON.stringify(candidate.validation.issues)) {
    await refreshValidation(db, id, report);
    candidate = { ...candidate, validation: report };
  }
  const [sources, revisions, activity, market] = await Promise.all([
    listCandidateSources(db, id),
    listRevisions(db, id),
    listAudit(db, { entityType: "candidate", entityId: id, limit: 50 }),
    getMarketByCandidate(db, id),
  ]);
  const { rows: items } = await db.query<{ id: string; analysis: unknown }>(
    "SELECT id, analysis FROM source_items WHERE candidate_id = $1 AND analysis IS NOT NULL",
    [id],
  );
  return Response.json({ candidate, sources, similar, revisions, activity, market, analyses: items });
});

export const PATCH = api<{ id: string }>(async ({ req, db, actor }, { id }) => {
  const body = candidateUpdateRequestSchema.parse(await readJson(req));
  const candidate = await editCandidate(db, id, body.expectedVersion, body.changes, actor);
  return Response.json({ candidate });
});
