import { createPglite, initDb, type Db } from "@/server/db/client";
import { SEED_SOURCES } from "@/server/db/seed";

/** Fresh in-memory Postgres (PGlite) with schema + seed data. */
export async function freshDb(opts: { onlyFixture?: boolean } = {}): Promise<Db> {
  const db = await initDb(await createPglite("memory"));
  if (opts.onlyFixture) {
    await db.query("UPDATE sources SET enabled = (type = 'fixture')");
  }
  return db;
}

export const SEED_SOURCE_COUNT = SEED_SOURCES.length;

/** A fetch stub that serves canned bodies by URL and fails everything else. */
export function stubFetch(routes: Record<string, { status?: number; body: string } | Error>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const route = routes[url];
    if (!route) {
      const err = new TypeError("fetch failed");
      (err as TypeError & { cause?: unknown }).cause = { code: "ENOTFOUND" };
      throw err;
    }
    if (route instanceof Error) throw route;
    return new Response(route.body, { status: route.status ?? 200, headers: { "Content-Type": "application/xml" } });
  }) as typeof fetch;
}

export const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Sample</title>
<item><title><![CDATA[Central bank to announce rate decision on December 10, 2099]]></title>
<link>https://news.example.com/a?utm_source=rss</link><description>&lt;p&gt;The committee meets &amp; decides.&lt;/p&gt;</description>
<pubDate>Tue, 29 Sep 2026 10:00:00 GMT</pubDate><guid>a</guid></item>
<item><title>Single</title><link>/relative/link</link></item>
</channel></rss>`;
