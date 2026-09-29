import { ITEM_STATUSES } from "@/lib/domain";
import { api } from "@/server/http/handler";
import { listItems } from "@/server/repositories/others";

export const dynamic = "force-dynamic";

export const GET = api(async ({ req, db }) => {
  const status = req.nextUrl.searchParams.get("status") ?? undefined;
  const runId = req.nextUrl.searchParams.get("runId") ?? undefined;
  const valid = status && (ITEM_STATUSES as readonly string[]).includes(status) ? status : undefined;
  return Response.json({ items: await listItems(db, { status: valid, runId, limit: 300 }) });
});
