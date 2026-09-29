import { CANDIDATE_STATUSES, CATEGORIES, type CandidateStatus } from "@/lib/domain";
import { api } from "@/server/http/handler";
import { countByStatus, listCandidates } from "@/server/repositories/candidates";

export const dynamic = "force-dynamic";

export const GET = api(async ({ req, db }) => {
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status");
  const category = sp.get("category");
  const sort = sp.get("sort");
  const [candidates, counts] = await Promise.all([
    listCandidates(db, {
      status: status && (CANDIDATE_STATUSES as readonly string[]).includes(status) ? (status as CandidateStatus) : "all",
      category: category && (CATEGORIES as readonly string[]).includes(category) ? category : undefined,
      search: sp.get("q")?.slice(0, 100) || undefined,
      sort: sort === "newest" || sort === "closing" ? sort : "score",
    }),
    countByStatus(db),
  ]);
  return Response.json({ candidates, counts });
});
