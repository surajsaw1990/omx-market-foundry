import { prefilterScore } from "@/server/discovery/signals";
import { notFound } from "@/server/http/errors";
import { api } from "@/server/http/handler";
import { getSource } from "@/server/repositories/others";
import { fetchSourceItems } from "@/server/sources/fetcher";
import { SourceFetchError } from "@/server/sources/types";

export const dynamic = "force-dynamic";

/** Dry-run fetch: shows what the source returns and how the prefilter scores it. Stores nothing. */
export const POST = api<{ id: string }>(async ({ db }, { id }) => {
  const source = await getSource(db, id);
  if (!source) throw notFound("Source");
  const started = Date.now();
  try {
    const items = await fetchSourceItems(source);
    return Response.json({
      ok: true,
      ms: Date.now() - started,
      count: items.length,
      items: items.slice(0, 10).map((it) => ({ ...it, prefilter: prefilterScore(it.title, it.summary) })),
    });
  } catch (err) {
    const e = err as Error;
    return Response.json({ ok: false, ms: Date.now() - started, error: e instanceof SourceFetchError ? `${e.kind}: ${e.message}` : e.message });
  }
});
