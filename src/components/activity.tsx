"use client";

import { Bot, CheckCircle2, GitMerge, LogIn, Pencil, RotateCcw, Sparkles, Store, TriangleAlert, User, XCircle } from "lucide-react";
import Link from "next/link";
import type { AuditEvent } from "@/lib/domain";
import { cn, relativeTime } from "@/lib/format";

const ACTIONS: Record<string, { icon: React.ReactNode; label: string; tone: string }> = {
  created: { icon: <Sparkles className="size-3.5" />, label: "created the candidate", tone: "text-accent" },
  evidence_added: { icon: <GitMerge className="size-3.5" />, label: "added supporting evidence", tone: "text-cyan" },
  edited: { icon: <Pencil className="size-3.5" />, label: "edited", tone: "text-info" },
  approved: { icon: <CheckCircle2 className="size-3.5" />, label: "approved", tone: "text-ok" },
  rejected: { icon: <XCircle className="size-3.5" />, label: "rejected", tone: "text-bad" },
  reopened: { icon: <RotateCcw className="size-3.5" />, label: "reopened for review", tone: "text-warn" },
  returned_to_review: { icon: <TriangleAlert className="size-3.5" />, label: "returned it to review", tone: "text-warn" },
  market_created: { icon: <Store className="size-3.5" />, label: "created the market", tone: "text-accent" },
  market_creation_failed: { icon: <TriangleAlert className="size-3.5" />, label: "failed to create the market", tone: "text-bad" },
  signed_in: { icon: <LogIn className="size-3.5" />, label: "signed in", tone: "text-muted" },
  requeued: { icon: <RotateCcw className="size-3.5" />, label: "re-queued an item", tone: "text-muted" },
  updated: { icon: <Pencil className="size-3.5" />, label: "updated a source", tone: "text-muted" },
  deleted: { icon: <XCircle className="size-3.5" />, label: "deleted a source", tone: "text-muted" },
};

function detailText(e: AuditEvent): string | null {
  const d = e.details as Record<string, unknown>;
  switch (e.action) {
    case "edited":
      return `Changed ${(d.fields as string[] | undefined)?.join(", ") ?? "fields"}${d.statusReset ? " · approval reset" : ""} · score ${d.score}`;
    case "rejected":
      return d.reason ? `“${d.reason}”` : null;
    case "approved": {
      const ack = (d.acknowledgedWarnings as string[] | undefined) ?? [];
      return [d.note ? `“${d.note}”` : null, ack.length ? `acknowledged ${ack.length} warning(s)` : null].filter(Boolean).join(" · ") || null;
    }
    case "evidence_added":
      return `${d.title ?? ""}${d.conflict ? " · conflicts with existing sources" : ""}`;
    case "created":
      return `by ${d.generator} · score ${d.score}`;
    case "market_created":
      return `${d.externalId} via ${d.publisher}`;
    case "market_creation_failed":
      return String(d.error ?? "");
    case "returned_to_review":
      return String(d.reason ?? "");
    default:
      return null;
  }
}

export function ActivityFeed({ events, showEntity = false }: { events: AuditEvent[]; showEntity?: boolean }) {
  if (events.length === 0) return <p className="py-6 text-center text-sm text-faint">No activity yet.</p>;
  return (
    <ol className="relative space-y-3.5 before:absolute before:inset-y-1 before:left-[11px] before:w-px before:bg-line">
      {events.map((e) => {
        const meta = ACTIONS[e.action] ?? { icon: <User className="size-3.5" />, label: e.action.replace(/_/g, " "), tone: "text-muted" };
        const system = e.actor.startsWith("system:");
        const detail = detailText(e);
        return (
          <li key={e.id} className="relative flex gap-3 pl-0">
            <span className={cn("relative z-10 grid size-6 shrink-0 place-items-center rounded-full border border-line-strong bg-panel-2", meta.tone)}>{meta.icon}</span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="text-[13px] leading-5">
                <span className="inline-flex items-center gap-1 font-medium">
                  {system && <Bot className="size-3 text-faint" />}
                  {system ? e.actor.replace("system:", "") : e.actor}
                </span>{" "}
                <span className="text-muted">{meta.label}</span>
                {showEntity && e.entityType === "candidate" && (
                  <>
                    {" "}
                    <Link href={`/candidates/${e.entityId}`} className="text-muted underline decoration-line-strong underline-offset-2 hover:text-fg">
                      view
                    </Link>
                  </>
                )}
              </div>
              {detail && <div className="mt-0.5 line-clamp-2 text-xs text-faint">{detail}</div>}
              <div className="mt-0.5 text-[11px] text-faint">{relativeTime(e.createdAt)}</div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
