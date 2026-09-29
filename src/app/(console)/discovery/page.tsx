"use client";

import { ExternalLink, History, RotateCcw, ScanSearch } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { DiscoveryConsole, RunDiscoveryButton, useDiscoveryRun } from "@/components/discovery-runner";
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, Skeleton, type Tone } from "@/components/ui";
import type { RunDetailResponse } from "@/lib/api-types";
import { apiFetch, fetcher } from "@/lib/client";
import type { DiscoveryRun, ItemStatus, SourceItem } from "@/lib/domain";
import { cn, formatDateTime, relativeTime } from "@/lib/format";

const ITEM_TONE: Record<ItemStatus, Tone> = {
  new: "info",
  skipped: "neutral",
  unsuitable: "neutral",
  candidate: "accent",
  merged: "cyan",
  clustered: "cyan",
  failed: "bad",
};
const ITEM_LABEL: Record<ItemStatus, string> = {
  new: "Queued",
  skipped: "Filtered",
  unsuitable: "Not a market",
  candidate: "Candidate",
  merged: "Merged",
  clustered: "Same story",
  failed: "Failed",
};

function RunStatusBadge({ status }: { status: DiscoveryRun["status"] }) {
  const tone: Tone = status === "completed" ? "ok" : status === "running" ? "info" : status === "failed" ? "bad" : "warn";
  return (
    <Badge tone={tone} dot>
      {status.replace(/_/g, " ")}
    </Badge>
  );
}

function SignalTable({ items, onRequeued }: { items: SourceItem[]; onRequeued: () => void }) {
  const [filter, setFilter] = useState<ItemStatus | "all">("all");
  const [busy, setBusy] = useState<string | null>(null);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const i of items) c[i.status] = (c[i.status] ?? 0) + 1;
    return c;
  }, [items]);
  const ORDER: ItemStatus[] = ["candidate", "merged", "clustered", "failed", "unsuitable", "new", "skipped"];
  const shown = (filter === "all" ? items : items.filter((i) => i.status === filter))
    .slice()
    .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || b.prefilterScore - a.prefilterScore);

  async function requeue(id: string) {
    setBusy(id);
    try {
      await apiFetch(`/api/items/${id}/requeue`, { method: "POST" });
      toast.success("Item re-queued — it will be analyzed in the next run.");
      onRequeued();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 px-5 pb-3">
        {(["all", "candidate", "merged", "clustered", "unsuitable", "skipped", "failed", "new"] as const).map((s) => {
          const n = s === "all" ? items.length : (counts[s] ?? 0);
          if (s !== "all" && n === 0) return null;
          return (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={cn(
                "rounded-md border px-2 py-1 text-xs transition-colors",
                filter === s ? "border-accent/50 bg-accent/10 text-fg" : "border-line text-muted hover:text-fg",
              )}
            >
              {s === "all" ? "All" : ITEM_LABEL[s]} <span className="ml-1 font-mono text-faint">{n}</span>
            </button>
          );
        })}
      </div>
      <div className="scrollbar-thin max-h-[640px] divide-y divide-line overflow-y-auto border-t border-line">
        {shown.length === 0 && <EmptyState title="No items" description="Nothing matches this filter." />}
        {shown.map((it) => (
          <div key={it.id} className="grid gap-3 px-5 py-3 md:grid-cols-[110px_1fr_auto]" data-testid="signal-row">
            <div className="flex items-start gap-2 md:flex-col md:gap-1.5">
              <Badge tone={ITEM_TONE[it.status]}>{ITEM_LABEL[it.status]}</Badge>
              <div className="flex items-center gap-1.5" title="Prefilter score: cheap heuristic estimate of whether this item describes a future, measurable event">
                <div className="h-1 w-14 overflow-hidden rounded-full bg-panel-3">
                  <div className="h-full rounded-full bg-gradient-to-r from-accent to-cyan" style={{ width: `${Math.round(it.prefilterScore * 100)}%` }} />
                </div>
                <span className="font-mono text-[10px] text-faint">{it.prefilterScore.toFixed(2)}</span>
              </div>
            </div>
            <div className="min-w-0">
              <a href={it.url} target="_blank" rel="noreferrer noopener" className="group inline-flex items-start gap-1.5 text-sm font-medium hover:text-accent">
                <span className="line-clamp-2">{it.title}</span>
                <ExternalLink className="mt-0.5 size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
              </a>
              <div className="mt-0.5 text-[11px] text-faint">
                {it.sourceName} · published {relativeTime(it.publishedAt)}
              </div>
              {it.reason && <p className="mt-1.5 text-xs text-muted">{it.reason}</p>}
            </div>
            <div className="flex items-start gap-2">
              {it.candidateId && (
                <Link href={`/candidates/${it.candidateId}`}>
                  <Button size="sm" variant="outline">
                    Candidate
                  </Button>
                </Link>
              )}
              {["failed", "unsuitable", "skipped"].includes(it.status) && (
                <Button size="sm" variant="ghost" loading={busy === it.id} onClick={() => requeue(it.id)} icon={<RotateCcw className="size-3.5" />} title="Analyze again in the next run">
                  Re-queue
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DiscoveryInner() {
  const router = useRouter();
  const params = useSearchParams();
  const run = useDiscoveryRun();
  const { data: runsData, isLoading } = useSWR<{ runs: DiscoveryRun[] }>("/api/discovery/runs", fetcher);
  const runs = runsData?.runs ?? [];
  const selectedId = params.get("run") ?? runs[0]?.id ?? null;
  const { data: detail, mutate } = useSWR<RunDetailResponse>(selectedId ? `/api/discovery/runs/${selectedId}` : null, fetcher);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Discover · Analyze · Structure"
        title="Discovery"
        description="Fetch configured sources, prefilter for future measurable events, analyze the best signals and turn them into candidates. Runs never publish anything."
        actions={<RunDiscoveryButton run={run} size="lg" />}
      />
      <DiscoveryConsole run={run} />

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        <Card className="h-fit">
          <CardHeader title="Run history" icon={<History className="size-4" />} />
          <div className="space-y-1 px-2 pb-2">
            {isLoading && [0, 1, 2].map((i) => <Skeleton key={i} className="m-2 h-14" />)}
            {!isLoading && runs.length === 0 && <EmptyState title="No runs yet" description="Press “Run discovery” to start." />}
            {runs.map((r) => (
              <button
                key={r.id}
                onClick={() => router.replace(`/discovery?run=${r.id}`, { scroll: false })}
                className={cn("w-full rounded-lg px-3 py-2.5 text-left transition-colors", selectedId === r.id ? "bg-panel-3 ring-1 ring-line-strong" : "hover:bg-panel-2")}
              >
                <div className="flex items-center justify-between gap-2">
                  <RunStatusBadge status={r.status} />
                  <span className="text-[11px] text-faint">{relativeTime(r.startedAt)}</span>
                </div>
                <div className="mt-1.5 text-xs text-muted">
                  {r.stats.candidatesCreated ?? 0} new · {r.stats.candidatesMerged ?? 0} merged · {r.stats.itemsNew ?? 0} items · {r.trigger} by {r.triggeredBy}
                </div>
              </button>
            ))}
          </div>
        </Card>

        <Card>
          {!selectedId ? (
            <EmptyState icon={<ScanSearch className="size-5" />} title="Signal inspector" description="Select a run to see every item it ingested and what happened to it." />
          ) : !detail ? (
            <div className="space-y-3 p-5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : (
            <>
              <CardHeader
                title={<span className="flex items-center gap-2">Signal inspector <RunStatusBadge status={detail.run.status} /></span>}
                description={`Started ${formatDateTime(detail.run.startedAt)} · analyzer ${detail.run.analyzer} · ${detail.items.length} new item(s) ingested in this run`}
                icon={<ScanSearch className="size-4" />}
              />
              {detail.run.log.some((l) => l.level !== "info") && (
                <div className="mx-5 mb-3 space-y-1 rounded-lg border border-warn/25 bg-warn/5 p-3">
                  {detail.run.log
                    .filter((l) => l.level !== "info")
                    .map((l, i) => (
                      <p key={i} className={cn("text-xs", l.level === "error" ? "text-bad" : "text-warn")}>
                        {l.message}
                      </p>
                    ))}
                </div>
              )}
              {detail.items.length === 0 ? (
                <EmptyState title="No new items in this run" description="Every article from the sources had already been ingested (URL de-duplication), or all sources failed." />
              ) : (
                <SignalTable items={detail.items} onRequeued={() => mutate()} />
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

export default function DiscoveryPage() {
  return (
    <Suspense>
      <DiscoveryInner />
    </Suspense>
  );
}
