import { api } from "@/server/http/handler";
import { listRuns } from "@/server/repositories/others";

export const dynamic = "force-dynamic";

export const GET = api(async ({ db }) => Response.json({ runs: await listRuns(db, 30) }));
