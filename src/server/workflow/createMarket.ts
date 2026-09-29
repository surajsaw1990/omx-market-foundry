/**
 * Approved candidate → OmniMarketX market.
 *
 * Order of operations (the external call cannot join our DB transaction):
 *  1. Load + check the candidate is `approved` and still has no blockers.
 *  2. Build the payload (including provenance: every linked source survives into the market).
 *  3. Call the publisher with Idempotency-Key = candidate id. Retries after a crash or a
 *     double-click therefore return the same external market instead of creating a second one.
 *  4. In one transaction: record the market locally, move the candidate to `market_created`,
 *     write the audit event. If this step fails, the next attempt replays step 3 idempotently.
 */
import { CATEGORIES, type Candidate, type Market, type OmxMarketPayload } from "@/lib/domain";
import type { Db } from "../db/client";
import { AppError, conflict, notFound } from "../http/errors";
import { logger } from "../logger";
import { createPublisher, type MarketPublisher } from "../markets/publisher";
import { getCandidate, listCandidateSources, updateCandidate } from "../repositories/candidates";
import { audit, getMarketByCandidate, insertMarket } from "../repositories/others";
import { validateWithContext } from "./context";

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80)
    .replace(/-$/, "");
}

export function buildMarketPayload(c: Candidate, sources: Awaited<ReturnType<typeof listCandidateSources>>): OmxMarketPayload {
  if (!c.closeDate) throw new AppError(422, "INVALID_MARKET", "Candidate has no close date.");
  return {
    title: c.question,
    slug: slugify(c.question),
    description: c.description,
    category: (CATEGORIES as readonly string[]).includes(c.category) ? c.category : "Other",
    marketType: c.outcomeType === "binary" ? "binary" : "categorical",
    outcomes: c.outcomes.map((o, i) => ({ id: slugify(o.label) || `outcome-${i + 1}`, label: o.label })),
    closesAt: c.closeDate,
    expectedResolutionAt: c.eventDate,
    resolution: {
      criteria: c.resolutionCriteria,
      source: { name: c.resolutionSourceName, url: c.resolutionSourceUrl },
    },
    tags: c.tags,
    provenance: {
      candidateId: c.id,
      candidateVersion: c.version,
      generator: c.generator,
      approvedBy: c.reviewedBy ?? "unknown",
      approvedAt: c.reviewedAt ?? new Date().toISOString(),
      sources: sources
        .filter((s) => s.role !== "conflicting")
        .map((s) => ({ title: s.title, url: s.url, publisher: s.sourceName, publishedAt: s.publishedAt })),
    },
  };
}

export async function createMarketFromCandidate(
  db: Db,
  candidateId: string,
  actor: string,
  publisher: MarketPublisher = createPublisher(db),
): Promise<{ market: Market; replay: boolean }> {
  const candidate = await getCandidate(db, candidateId);
  if (!candidate) throw notFound("Candidate");

  if (candidate.status === "market_created") {
    const existing = await getMarketByCandidate(db, candidateId);
    if (existing) return { market: existing, replay: true };
  }
  if (candidate.status !== "approved") {
    throw conflict("NOT_APPROVED", "Only approved candidates can be turned into markets. A reviewer must approve it first.");
  }
  const { report } = await validateWithContext(db, candidate);
  if (report.blockers > 0) {
    throw new AppError(422, "BLOCKING_ISSUES", "The candidate now has blocking issues (e.g. its close date passed). Send it back to review.", report.issues.filter((i) => i.severity === "blocker"));
  }

  const sources = await listCandidateSources(db, candidateId);
  const payload = buildMarketPayload(candidate, sources);

  let record;
  try {
    record = await publisher.createMarket(payload, `candidate:${candidateId}`);
  } catch (err) {
    await audit(db, {
      entityType: "candidate",
      entityId: candidateId,
      action: "market_creation_failed",
      actor,
      details: { publisher: publisher.name, error: (err as Error).message },
    });
    logger.error("market.create_failed", { candidateId, err });
    throw err;
  }

  return db.tx(async (q) => {
    const existing = await getMarketByCandidate(q, candidateId);
    if (existing) return { market: existing, replay: true };
    await insertMarket(q, {
      candidateId,
      externalId: record.id,
      externalUrl: record.url,
      slug: payload.slug,
      question: payload.title,
      category: payload.category,
      status: record.status,
      payload,
      eventDate: candidate.eventDate,
      createdBy: actor,
    });
    const ok = await updateCandidate(q, candidateId, candidate.version, {}, { status: "market_created" });
    if (!ok) throw conflict("VERSION_CONFLICT", "The candidate changed while the market was being created. Reload and try again.");
    await audit(q, {
      entityType: "candidate",
      entityId: candidateId,
      action: "market_created",
      actor,
      details: { externalId: record.id, publisher: publisher.name, idempotentReplay: record.idempotentReplay },
    });
    const market = (await getMarketByCandidate(q, candidateId))!;
    logger.info("market.created", { candidateId, marketId: market.id, externalId: record.id });
    return { market, replay: record.idempotentReplay };
  });
}
