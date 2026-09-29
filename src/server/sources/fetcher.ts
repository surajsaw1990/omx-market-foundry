/**
 * Source fetching with timeouts, one retry for transient failures and typed errors, plus URL
 * canonicalisation used for de-duplicating repeated ingestion of the same article.
 */
import type { Source } from "@/lib/domain";
import { config } from "../config";
import { sha256 } from "../ids";
import { fixtureItems } from "./fixtures";
import { parseFeed } from "./rss";
import { SourceFetchError, type RawFeedItem } from "./types";

const TRACKING_PARAMS = /^(utm_|fbclid|gclid|mc_|at_medium|at_campaign|ns_|ocid|cmpid|ref$|src$)/i;

/** Canonical form of an article URL: lowercase host, no fragment, no tracking params, no trailing slash. */
export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    for (const key of [...u.searchParams.keys()]) if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
    u.searchParams.sort();
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.replace(/\/+$/, "");
    return u.toString().replace(/^http:/, "https:");
  } catch {
    return url.trim();
  }
}

export function urlHash(url: string): string {
  return sha256(canonicalUrl(url));
}

export function contentHash(item: Pick<RawFeedItem, "title" | "summary">): string {
  return sha256(`${item.title.trim().toLowerCase()}\n${item.summary.trim().toLowerCase()}`);
}

type FetchFn = typeof fetch;

async function fetchOnce(url: string, fetchImpl: FetchFn): Promise<string> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: {
        "User-Agent": "OmniMarketX-Discovery/1.0 (+internal market research tool)",
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(config.sourceTimeoutMs),
      cache: "no-store",
    });
  } catch (err) {
    const e = err as Error;
    if (e.name === "TimeoutError" || e.name === "AbortError") throw new SourceFetchError(`Timed out after ${config.sourceTimeoutMs}ms`, "timeout");
    const cause = (e as Error & { cause?: { code?: string } }).cause?.code;
    throw new SourceFetchError(`Network error${cause ? ` (${cause})` : ""}: ${e.message}`, "network");
  }
  if (!res.ok) throw new SourceFetchError(`HTTP ${res.status} ${res.statusText}`.trim(), "http", res.status);
  const body = await res.text();
  if (body.length > 5_000_000) throw new SourceFetchError("Feed larger than 5 MB", "parse");
  return body;
}

export async function fetchSourceItems(
  source: Pick<Source, "type" | "url">,
  opts: { fetchImpl?: FetchFn; now?: Date } = {},
): Promise<RawFeedItem[]> {
  if (source.type === "fixture") return fixtureItems(opts.now);

  const fetchImpl = opts.fetchImpl ?? fetch;
  let body: string;
  try {
    body = await fetchOnce(source.url, fetchImpl);
  } catch (err) {
    const e = err as SourceFetchError;
    // Retry once on transient failures only; DNS failures and 4xx are not worth retrying.
    const transient = e.kind === "timeout" || (e.kind === "http" && (e.status ?? 0) >= 500) || (e.kind === "network" && !/ENOTFOUND|EAI_AGAIN/.test(e.message));
    if (!transient) throw e;
    await new Promise((r) => setTimeout(r, 400));
    body = await fetchOnce(source.url, fetchImpl);
  }
  const items = parseFeed(body, source.url, config.maxItemsPerSource);
  if (items.length === 0) throw new SourceFetchError("Feed contained no usable items", "empty");
  return items;
}
