/**
 * Builds the context the validation engine needs (linked sources, similar candidates/markets)
 * and recomputes a candidate's stored validation report.
 */
import type { Candidate, CandidateEditInput, SimilarItem, ValidationReport } from "@/lib/domain";
import { questionSimilarity } from "@/lib/similarity";
import { validateCandidate, type ValidationSourceInfo } from "@/lib/validation";
import type { Queryable } from "../db/client";
import { listCandidateSources, listForDedupe, refreshValidation, getCandidate } from "../repositories/candidates";
import { listMarketsForDedupe } from "../repositories/others";

export function toEditInput(c: Candidate): CandidateEditInput {
  return {
    question: c.question,
    category: c.category,
    description: c.description,
    outcomeType: c.outcomeType,
    outcomes: c.outcomes,
    eventDate: c.eventDate,
    closeDate: c.closeDate,
    resolutionCriteria: c.resolutionCriteria,
    resolutionSourceName: c.resolutionSourceName,
    resolutionSourceUrl: c.resolutionSourceUrl,
    tags: c.tags,
  };
}

export async function findSimilar(
  q: Queryable,
  subject: { question: string; eventDate: string | null; eventKey?: string | null },
  excludeCandidateId?: string,
  minSimilarity = 0.35,
): Promise<SimilarItem[]> {
  const [candidates, markets] = await Promise.all([listForDedupe(q, excludeCandidateId), listMarketsForDedupe(q)]);
  const out: SimilarItem[] = [];
  for (const c of candidates) {
    const similarity = questionSimilarity(subject, c);
    if (similarity >= minSimilarity) out.push({ kind: "candidate", id: c.id, question: c.question, status: c.status, similarity });
  }
  for (const m of markets) {
    if (excludeCandidateId && m.candidateId === excludeCandidateId) continue; // the market created from this candidate
    const similarity = questionSimilarity({ question: subject.question, eventDate: subject.eventDate }, m);
    if (similarity >= minSimilarity) out.push({ kind: "market", id: m.id, question: m.question, status: m.status, similarity });
  }
  return out.sort((a, b) => b.similarity - a.similarity).slice(0, 6);
}

export async function sourcesForValidation(q: Queryable, candidateId: string): Promise<ValidationSourceInfo[]> {
  const links = await listCandidateSources(q, candidateId);
  return links.map((l) => ({
    url: l.url,
    publishedAt: l.publishedAt,
    reliability: l.sourceReliability,
    role: l.role,
    facts: l.facts,
    sourceName: l.sourceName,
  }));
}

/** Validates a (possibly edited) candidate against current DB state. */
export async function validateWithContext(
  q: Queryable,
  candidate: Candidate,
  input: CandidateEditInput = toEditInput(candidate),
  now = new Date(),
): Promise<{ report: ValidationReport; similar: SimilarItem[] }> {
  const [sources, similar] = await Promise.all([
    sourcesForValidation(q, candidate.id),
    findSimilar(q, { question: input.question, eventDate: input.eventDate, eventKey: candidate.eventKey }, candidate.id),
  ]);
  const report = validateCandidate(input, {
    now,
    sources,
    similar,
    ambiguityNotes: candidate.ambiguityNotes,
    confidence: candidate.confidence,
    generator: candidate.generator,
  });
  return { report, similar };
}

export async function revalidateCandidate(q: Queryable, id: string): Promise<ValidationReport | null> {
  const candidate = await getCandidate(q, id);
  if (!candidate) return null;
  const { report } = await validateWithContext(q, candidate);
  await refreshValidation(q, id, report);
  return report;
}
