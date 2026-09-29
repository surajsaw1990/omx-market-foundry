/**
 * Idempotent seed: configurable sources and a handful of "already live" markets used by duplicate
 * detection. Safe to run on every boot — inserts are keyed on unique slugs.
 */
import type { Category, ReliabilityTier, SourceType } from "@/lib/domain";
import { newId } from "../ids";
import { seedMarkets } from "../sources/fixtures";
import type { Db } from "./client";

interface SeedSource {
  slug: string;
  name: string;
  type: SourceType;
  url: string;
  categoryHint: Category | null;
  reliability: ReliabilityTier;
  enabled: boolean;
}

export const SEED_SOURCES: SeedSource[] = [
  { slug: "demo-wire", name: "Demo Wire (synthetic fixtures)", type: "fixture", url: "fixture://demo-wire", categoryHint: null, reliability: "synthetic", enabled: true },
  { slug: "fed-press", name: "Federal Reserve — Press releases", type: "rss", url: "https://www.federalreserve.gov/feeds/press_all.xml", categoryHint: "Economics", reliability: "official", enabled: true },
  { slug: "ecb-press", name: "European Central Bank — Press", type: "rss", url: "https://www.ecb.europa.eu/rss/press.html", categoryHint: "Economics", reliability: "official", enabled: true },
  { slug: "nasa-news", name: "NASA — News releases", type: "rss", url: "https://www.nasa.gov/news-release/feed/", categoryHint: "Science", reliability: "official", enabled: true },
  { slug: "bbc-business", name: "BBC News — Business", type: "rss", url: "https://feeds.bbci.co.uk/news/business/rss.xml", categoryHint: "Business", reliability: "major_media", enabled: true },
  { slug: "bbc-technology", name: "BBC News — Technology", type: "rss", url: "https://feeds.bbci.co.uk/news/technology/rss.xml", categoryHint: "Technology", reliability: "major_media", enabled: true },
  { slug: "bbc-sport", name: "BBC Sport", type: "rss", url: "https://feeds.bbci.co.uk/sport/rss.xml", categoryHint: "Sports", reliability: "major_media", enabled: true },
  { slug: "npr-politics", name: "NPR — Politics", type: "rss", url: "https://feeds.npr.org/1014/rss.xml", categoryHint: "Politics", reliability: "major_media", enabled: true },
  { slug: "guardian-economics", name: "The Guardian — Economics", type: "rss", url: "https://www.theguardian.com/business/economics/rss", categoryHint: "Economics", reliability: "major_media", enabled: false },
  { slug: "techcrunch", name: "TechCrunch", type: "rss", url: "https://techcrunch.com/feed/", categoryHint: "Technology", reliability: "aggregator", enabled: false },
  // Intentionally unreachable: demonstrates per-source failure isolation and health tracking.
  { slug: "legacy-wire", name: "Legacy wire feed (decommissioned)", type: "rss", url: "https://feeds.legacy-wire.invalid/top-stories.xml", categoryHint: null, reliability: "major_media", enabled: true },
];

export async function seedDatabase(db: Db): Promise<void> {
  for (const s of SEED_SOURCES) {
    await db.query(
      `INSERT INTO sources (id, slug, name, type, url, category_hint, reliability, enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (slug) DO NOTHING`,
      [newId("src"), s.slug, s.name, s.type, s.url, s.categoryHint, s.reliability, s.enabled],
    );
  }

  const { rows } = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM markets WHERE is_seed");
  if (Number(rows[0]?.n ?? 0) > 0) return;

  for (const [i, m] of seedMarkets().entries()) {
    const id = newId("mkt");
    const externalId = `omx_seed_${i + 1}`;
    const slug = m.question.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
    const payload = {
      title: m.question,
      slug,
      description: "Pre-existing market (seed data) used to demonstrate duplicate detection.",
      category: m.category,
      marketType: "binary",
      outcomes: [
        { id: "yes", label: "Yes" },
        { id: "no", label: "No" },
      ],
      closesAt: m.eventDate,
      expectedResolutionAt: m.eventDate,
      resolution: { criteria: "Seed market.", source: m.resolutionSource },
      tags: ["seed"],
      provenance: { candidateId: "", candidateVersion: 0, generator: "seed", approvedBy: "system", approvedAt: new Date().toISOString(), sources: [] },
    };
    await db.query(
      `INSERT INTO markets (id, candidate_id, external_id, external_url, slug, question, category, status, payload, event_date, is_seed, created_by)
       VALUES ($1, NULL, $2, $3, $4, $5, $6, 'open', $7, $8, TRUE, 'seed')`,
      [id, externalId, `https://omnimarketx.example/markets/${externalId}`, slug, m.question, m.category, JSON.stringify(payload), m.eventDate],
    );
  }
}
