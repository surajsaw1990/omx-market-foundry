"use client";

import { ChevronDown, ExternalLink, FileStack, FlaskConical, Landmark, Newspaper, Users } from "lucide-react";
import { useState } from "react";
import type { CandidateSourceLink, ReliabilityTier } from "@/lib/domain";
import { cn, formatDate, hostname, relativeTime } from "@/lib/format";
import { Badge, Card, CardHeader, type Tone } from "../ui";

const RELIABILITY: Record<ReliabilityTier, { label: string; tone: Tone; icon: React.ReactNode }> = {
  official: { label: "Official", tone: "ok", icon: <Landmark className="size-3" /> },
  major_media: { label: "Major media", tone: "info", icon: <Newspaper className="size-3" /> },
  aggregator: { label: "Aggregator", tone: "neutral", icon: <Newspaper className="size-3" /> },
  community: { label: "Community", tone: "warn", icon: <Users className="size-3" /> },
  synthetic: { label: "Synthetic demo", tone: "warn", icon: <FlaskConical className="size-3" /> },
};

export function ReliabilityBadge({ tier }: { tier: ReliabilityTier }) {
  const r = RELIABILITY[tier] ?? RELIABILITY.aggregator;
  return (
    <Badge tone={r.tone}>
      {r.icon}
      {r.label}
    </Badge>
  );
}

function SourceCard({ s, conflict, candidateEventDate }: { s: CandidateSourceLink; conflict: boolean; candidateEventDate: string | null }) {
  const [open, setOpen] = useState(s.role === "primary");
  const reported = s.facts?.eventDate ?? null;
  const differs = reported && candidateEventDate && Math.abs(Date.parse(reported) - Date.parse(candidateEventDate)) > 86_400_000;
  return (
    <div className={cn("rounded-xl border bg-panel-2/40 transition-colors", differs && conflict ? "border-warn/30" : "border-line")} data-testid="source-card">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-3 px-4 py-3 text-left">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={s.role === "primary" ? "accent" : s.role === "conflicting" ? "bad" : "cyan"}>{s.role}</Badge>
            <ReliabilityBadge tier={s.sourceReliability} />
            {reported && (
              <Badge tone={differs && conflict ? "warn" : "neutral"}>reports event: {formatDate(reported)}</Badge>
            )}
          </div>
          <div className="mt-2 text-sm font-medium leading-snug">{s.title}</div>
          <div className="mt-1 text-[11px] text-faint">
            {s.sourceName} · {hostname(s.url)} · published {relativeTime(s.publishedAt)}
          </div>
        </div>
        <ChevronDown className={cn("mt-1 size-4 shrink-0 text-faint transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="animate-fade-in space-y-3 border-t border-line px-4 py-3">
          <p className="text-[13px] leading-relaxed text-muted">{s.summary || "No summary provided by the feed."}</p>
          {s.facts?.keyClaims && s.facts.keyClaims.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-faint">Extracted claims</div>
              <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted">
                {s.facts.keyClaims.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}
          <a href={s.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline">
            Open original article <ExternalLink className="size-3" />
          </a>
        </div>
      )}
    </div>
  );
}

export function SourcesPanel({ sources, conflict, candidateEventDate }: { sources: CandidateSourceLink[]; conflict: boolean; candidateEventDate: string | null }) {
  return (
    <Card>
      <CardHeader
        title={`Supporting sources (${sources.length})`}
        description="Every article linked to this candidate. Provenance is carried into the created market."
        icon={<FileStack className="size-4" />}
      />
      <div className="space-y-2.5 px-5 pb-5">
        {conflict && (
          <div className="rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-xs text-warn">
            Sources report different event dates. Confirm the governing date with the official source before approving.
          </div>
        )}
        {sources.map((s) => (
          <SourceCard key={s.itemId} s={s} conflict={conflict} candidateEventDate={candidateEventDate} />
        ))}
      </div>
    </Card>
  );
}
