/**
 * RSS 2.0 / Atom / RDF parsing into a normalised item list. Real-world feeds are messy: BOMs,
 * CDATA, HTML in descriptions, missing dates, single-item channels (not arrays), relative links.
 */
import { XMLParser } from "fast-xml-parser";
import { SourceFetchError, type RawFeedItem } from "./types";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  cdataPropName: false,
  processEntities: true,
  htmlEntities: true,
  trimValues: true,
});

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function text(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (typeof v === "object" && v !== null && "#text" in v) return String((v as Record<string, unknown>)["#text"] ?? "");
  return "";
}

const ENTITY: Record<string, string> = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'" };

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(nbsp|amp|lt|gt|quot|#39|apos);/g, (m) => ENTITY[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

function parseDate(v: unknown): string | null {
  const s = text(v).trim();
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function resolveLink(link: string, base: string): string {
  try {
    return new URL(link, base).toString();
  } catch {
    return "";
  }
}

function atomLink(entry: Record<string, unknown>): string {
  const links = asArray(entry.link as Record<string, unknown> | Record<string, unknown>[]);
  const alt = links.find((l) => typeof l === "object" && (!l["@_rel"] || l["@_rel"] === "alternate")) ?? links[0];
  if (!alt) return "";
  if (typeof alt === "string") return alt;
  return String(alt["@_href"] ?? text(alt));
}

export function parseFeed(xml: string, feedUrl: string, limit = 50): RawFeedItem[] {
  const cleaned = xml.replace(/^﻿/, "").trim();
  if (!cleaned.startsWith("<")) throw new SourceFetchError("Response is not XML", "parse");
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(cleaned) as Record<string, unknown>;
  } catch (err) {
    throw new SourceFetchError(`Malformed XML: ${(err as Error).message}`, "parse");
  }

  let entries: Record<string, unknown>[] = [];
  let atom = false;
  const rss = doc.rss as Record<string, unknown> | undefined;
  const rdf = doc["rdf:RDF"] as Record<string, unknown> | undefined;
  const feed = doc.feed as Record<string, unknown> | undefined;
  if (rss?.channel) entries = asArray((rss.channel as Record<string, unknown>).item as Record<string, unknown>[]);
  else if (rdf) entries = asArray(rdf.item as Record<string, unknown>[]);
  else if (feed) {
    atom = true;
    entries = asArray(feed.entry as Record<string, unknown>[]);
  } else throw new SourceFetchError("Unrecognised feed format (expected RSS, RDF or Atom)", "parse");

  const items: RawFeedItem[] = [];
  for (const e of entries.slice(0, limit)) {
    const title = stripHtml(text(e.title));
    const rawLink = atom ? atomLink(e) : text(e.link) || text(e.guid);
    const url = resolveLink(rawLink.trim(), feedUrl);
    if (!title || !url) continue;
    const summary = stripHtml(
      text(e.description) || text(e.summary) || text(e["content:encoded"]) || text(e.content) || "",
    ).slice(0, 1500);
    items.push({
      externalId: text(e.guid) || text(e.id) || undefined,
      url,
      title: title.slice(0, 500),
      summary,
      publishedAt: parseDate(e.pubDate ?? e.published ?? e.updated ?? e["dc:date"]),
    });
  }
  return items;
}
