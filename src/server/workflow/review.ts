/**
 * Human review operations. Every mutation:
 *  - uses optimistic locking (`expectedVersion`) so concurrent reviewers cannot overwrite each other,
 *  - enforces the status state machine,
 *  - re-runs validation server-side (the client-side preview is advisory only),
 *  - writes an audit event (and a revision diff for edits) in the same transaction.
 */
import {
  candidateEditSchema,
  type Candidate,
  type CandidateEditInput,
  type CandidateStatus,
} from "@/lib/domain";
import type { Db, Queryable } from "../db/client";
import { AppError, conflict, notFound } from "../http/errors";
import { getCandidate, insertRevision, updateCandidate } from "../repositories/candidates";
import { audit } from "../repositories/others";
import { toEditInput, validateWithContext } from "./context";

export const TRANSITIONS: Record<CandidateStatus, CandidateStatus[]> = {
  pending_review: ["approved", "rejected"],
  approved: ["pending_review", "rejected", "market_created"],
  rejected: ["pending_review"],
  market_created: [],
};

export function assertTransition(from: CandidateStatus, to: CandidateStatus) {
  if (!TRANSITIONS[from].includes(to)) {
    throw conflict("INVALID_TRANSITION", `Cannot move a candidate from "${from}" to "${to}".`);
  }
}

async function load(q: Queryable, id: string, expectedVersion?: number): Promise<Candidate> {
  const c = await getCandidate(q, id);
  if (!c) throw notFound("Candidate");
  if (expectedVersion !== undefined && c.version !== expectedVersion) {
    throw conflict("VERSION_CONFLICT", "This candidate was changed by someone else. Reload to see the latest version.", {
      currentVersion: c.version,
    });
  }
  return c;
}

function versionConflict(): AppError {
  return conflict("VERSION_CONFLICT", "This candidate was changed by someone else. Reload to see the latest version.");
}

function diff(before: CandidateEditInput, after: CandidateEditInput) {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after) as (keyof CandidateEditInput)[]) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changes[key] = { from: before[key], to: after[key] };
  }
  return changes;
}

export async function editCandidate(
  db: Db,
  id: string,
  expectedVersion: number,
  changes: Partial<CandidateEditInput>,
  actor: string,
): Promise<Candidate> {
  return db.tx(async (q) => {
    const current = await load(q, id, expectedVersion);
    if (current.status === "market_created") throw conflict("LOCKED", "A market has already been created from this candidate; it can no longer be edited.");
    if (current.status === "rejected") throw conflict("LOCKED", "Reopen the candidate before editing it.");

    const before = toEditInput(current);
    const parsed = candidateEditSchema.safeParse({ ...before, ...changes });
    if (!parsed.success) {
      throw new AppError(422, "VALIDATION_FAILED", "Some fields are invalid.", parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })));
    }
    const after = parsed.data;
    const delta = diff(before, after);
    if (Object.keys(delta).length === 0) return current;

    const { report } = await validateWithContext(q, current, after);
    // Editing an approved candidate sends it back to review: the approval covered the old content.
    const status: CandidateStatus | undefined = current.status === "approved" ? "pending_review" : undefined;
    const ok = await updateCandidate(q, id, expectedVersion, after, {
      validation: report,
      status,
      ...(status ? { reviewedBy: null, reviewedAt: null } : {}),
    });
    if (!ok) throw versionConflict();
    await insertRevision(q, id, expectedVersion + 1, actor, delta);
    await audit(q, {
      entityType: "candidate",
      entityId: id,
      action: "edited",
      actor,
      details: { fields: Object.keys(delta), score: report.score, blockers: report.blockers, ...(status ? { statusReset: "approved → pending_review" } : {}) },
    });
    return (await getCandidate(q, id))!;
  });
}

export async function approveCandidate(
  db: Db,
  id: string,
  input: { expectedVersion: number; note?: string; acknowledgeWarnings?: boolean },
  actor: string,
): Promise<Candidate> {
  return db.tx(async (q) => {
    const current = await load(q, id, input.expectedVersion);
    assertTransition(current.status, "approved");
    // Re-validate at decision time: dates may have passed or a duplicate may have gone live since.
    const { report } = await validateWithContext(q, current);
    if (report.blockers > 0) {
      throw new AppError(422, "BLOCKING_ISSUES", `Resolve ${report.blockers} blocking issue(s) before approving.`, report.issues.filter((i) => i.severity === "blocker"));
    }
    if (report.warnings > 0 && !input.acknowledgeWarnings) {
      throw new AppError(422, "WARNINGS_NOT_ACKNOWLEDGED", `There are ${report.warnings} warning(s). Confirm you have reviewed them to approve.`, report.issues.filter((i) => i.severity === "warning"));
    }
    const now = new Date().toISOString();
    const ok = await updateCandidate(q, id, input.expectedVersion, {}, {
      validation: report,
      status: "approved",
      reviewedBy: actor,
      reviewedAt: now,
      reviewNote: input.note ?? null,
    });
    if (!ok) throw versionConflict();
    await audit(q, {
      entityType: "candidate",
      entityId: id,
      action: "approved",
      actor,
      details: { note: input.note ?? null, score: report.score, acknowledgedWarnings: report.issues.filter((i) => i.severity === "warning").map((i) => i.code) },
    });
    return (await getCandidate(q, id))!;
  });
}

export async function rejectCandidate(db: Db, id: string, input: { expectedVersion: number; reason: string }, actor: string): Promise<Candidate> {
  return db.tx(async (q) => {
    const current = await load(q, id, input.expectedVersion);
    assertTransition(current.status, "rejected");
    const ok = await updateCandidate(q, id, input.expectedVersion, {}, {
      status: "rejected",
      reviewedBy: actor,
      reviewedAt: new Date().toISOString(),
      reviewNote: input.reason,
    });
    if (!ok) throw versionConflict();
    await audit(q, { entityType: "candidate", entityId: id, action: "rejected", actor, details: { reason: input.reason } });
    return (await getCandidate(q, id))!;
  });
}

export async function reopenCandidate(db: Db, id: string, input: { expectedVersion: number }, actor: string): Promise<Candidate> {
  return db.tx(async (q) => {
    const current = await load(q, id, input.expectedVersion);
    assertTransition(current.status, "pending_review");
    const { report } = await validateWithContext(q, current);
    const ok = await updateCandidate(q, id, input.expectedVersion, {}, {
      status: "pending_review",
      validation: report,
      reviewedBy: null,
      reviewedAt: null,
      reviewNote: null,
    });
    if (!ok) throw versionConflict();
    await audit(q, { entityType: "candidate", entityId: id, action: "reopened", actor, details: { from: current.status } });
    return (await getCandidate(q, id))!;
  });
}
