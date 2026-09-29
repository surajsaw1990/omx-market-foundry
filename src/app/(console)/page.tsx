"use client";

import { Activity, ArrowRight, ChevronRight, Filter, Inbox, Radar, Rss, ScanSearch, Sparkles, Store, ThumbsUp } from "lucide-react";
import Link from "next/link";
import useSWR from "swr";
import { DiscoveryConsole, RunDiscoveryButton, useDiscoveryRun } from "@/components/discovery-runner";
import { ActivityFeed } from "@/components/activity";
import { Badge, Card, CardHeader, EmptyState, PageHeader, ScoreRing, Skeleton } from "@/components/ui";
import type { MeResponse, OverviewResponse } from "@/lib/api-types";
import { fetcher } from "@/lib/client";
import { cn, relativeTime } from "@/lib/format";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function Funnel({ data }: { data: OverviewResponse }) {
  const items = data.items;
  const total = Object.values(items).reduce((a, b) => a + b, 0);
  const analyzed = (items.candidate ?? 0) + (items.merged ?? 0) + (items.unsuitable ?? 0) + (items.failed ?? 0) + (items.clustered ?? 0);
  const candidates = Object.values(data.candidates).reduce((a, b) => a + b, 0);
  const steps = [
    { label: "Signals ingested", value: total, icon: Rss, hint: "Unique articles fetched" },
    { label: "Filtered out", value: items.skipped ?? 0, icon: Filter, hint: "Cheap prefilter, no LLM cost" },
    { label: "Analyzed", value: analyzed, icon: ScanSearch, hint: `${items.new ?? 0} queued` },
    { label: "Candidates", value: candidates, icon: Sparkles, hint: `${data.candidates.pending_review ?? 0} awaiting review` },
    { label: "Approved", value: (data.candidates.approved ?? 0) + (data.candidates.market_created ?? 0), icon: ThumbsUp, hint: `${data.candidates.rejected ?? 0} rejected` },
    { label: "Markets created", value: data.marketsCreated, icon: Store, hint: "Via OMX market API" },
  ];
  return (
    <Card className="p-1.5">
      <div className="grid grid-cols-2 gap-1.5 md:grid-cols-3 xl:grid-cols-6">
        {steps.map((s, i) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="relative rounded-[10px] border border-line/60 bg-panel-2/60 px-4 py-3.5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] text-faint">{String(i + 1).padStart(2, "0")}</span>
                <Icon className="size-3.5 text-faint" />
              </div>
              <div className="mt-2 font-mono text-2xl font-semibold tabular-nums tracking-tight">{s.value}</div>
              <div className="text-xs font-medium text-fg/90">{s.label}</div>
              <div className="mt-0.5 truncate text-[11px] text-faint">{s.hint}</div>
              {i < steps.length - 1 && <ChevronRight className="absolute -right-3 top-1/2 z-10 hidden size-4 -translate-y-1/2 text-line-strong xl:block" />}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export default function DashboardPage() {
  const { data, isLoading } = useSWR<OverviewResponse>("/api/overview", fetcher, { refreshInterval: 30_000 });
  const { data: me } = useSWR<MeResponse>("/api/auth/me", fetcher);
  const run = useDiscoveryRun();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Dashboard"
        title={`${greeting()}${me?.user ? `, ${me.user.name.split(" ")[0]}` : ""}`}
        description="Discover → Analyze → Structure → Validate → Review → Create. Automation drafts; humans decide."
        actions={
          <>
            <Link href="/candidates">
              <button className="inline-flex h-11 items-center gap-2 rounded-lg border border-line-strong bg-panel-3 px-4 text-sm font-medium hover:bg-[#222739]">
                <Inbox className="size-4" /> Review queue
                {!!data?.candidates.pending_review && <Badge tone="warn">{data.candidates.pending_review}</Badge>}
              </button>
            </Link>
            <RunDiscoveryButton run={run} size="lg" />
          </>
        }
      />

      {isLoading || !data ? <Skeleton className="h-[132px]" /> : <Funnel data={data} />}

      <DiscoveryConsole run={run} />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Needs review"
            description="Highest-quality pending candidates first"
            icon={<Inbox className="size-4" />}
            actions={
              <Link href="/candidates" className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg">
                View all <ArrowRight className="size-3" />
              </Link>
            }
          />
          <div className="px-2 pb-2">
            {!data ? (
              <div className="space-y-2 p-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
            ) : data.attention.length === 0 ? (
              <EmptyState icon={<Radar className="size-5" />} title="Queue is clear" description="Run discovery to pull fresh signals from your sources." />
            ) : (
              data.attention.map((c) => (
                <Link key={c.id} href={`/candidates/${c.id}`} className="group flex items-center gap-4 rounded-lg px-3 py-3 transition-colors hover:bg-panel-2">
                  <ScoreRing score={c.validation.score} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium group-hover:text-white">{c.question}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-faint">
                      <span>{c.category}</span>
                      <span>·</span>
                      <span>closes {relativeTime(c.closeDate)}</span>
                      {c.validation.blockers > 0 && <Badge tone="bad">{c.validation.blockers} blocker{c.validation.blockers > 1 ? "s" : ""}</Badge>}
                      {c.validation.warnings > 0 && <Badge tone="warn">{c.validation.warnings} warning{c.validation.warnings > 1 ? "s" : ""}</Badge>}
                    </div>
                  </div>
                  <ChevronRight className="size-4 text-faint group-hover:text-muted" />
                </Link>
              ))
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Source health"
            description="Last fetch per enabled source"
            icon={<Rss className="size-4" />}
            actions={
              <Link href="/sources" className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg">
                Manage <ArrowRight className="size-3" />
              </Link>
            }
          />
          <div className="space-y-1 px-3 pb-3">
            {!data
              ? [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-9" />)
              : data.sources
                  .filter((s) => s.enabled)
                  .map((s) => (
                    <div key={s.id} className="flex items-center gap-3 rounded-lg px-2 py-2" title={s.lastError ?? undefined}>
                      <span className={cn("size-2 shrink-0 rounded-full", s.lastStatus === "ok" ? "bg-ok" : s.lastStatus === "error" ? "bg-bad" : "bg-line-strong")} />
                      <span className="min-w-0 flex-1 truncate text-sm">{s.name}</span>
                      <span className="shrink-0 text-[11px] text-faint">{s.lastFetchedAt ? relativeTime(s.lastFetchedAt) : "never"}</span>
                    </div>
                  ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Recent discovery runs"
            icon={<Radar className="size-4" />}
            actions={
              <Link href="/discovery" className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg">
                History <ArrowRight className="size-3" />
              </Link>
            }
          />
          <div className="px-3 pb-3">
            {!data ? (
              <Skeleton className="h-24" />
            ) : data.runs.length === 0 ? (
              <EmptyState title="No runs yet" description="Trigger the first discovery run above." />
            ) : (
              data.runs.map((r) => (
                <Link key={r.id} href={`/discovery?run=${r.id}`} className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-panel-2">
                  <Badge tone={r.status === "completed" ? "ok" : r.status === "running" ? "info" : r.status === "failed" ? "bad" : "warn"} dot>
                    {r.status.replace(/_/g, " ")}
                  </Badge>
                  <span className="flex-1 truncate text-sm text-muted">
                    <span className="text-fg">{r.stats.candidatesCreated ?? 0}</span> new · <span className="text-fg">{r.stats.candidatesMerged ?? 0}</span> merged ·{" "}
                    <span className="text-fg">{r.stats.itemsNew ?? 0}</span> items
                  </span>
                  <span className="text-[11px] text-faint">{relativeTime(r.startedAt)}</span>
                </Link>
              ))
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Activity" description="Audit log of system and reviewer actions" icon={<Activity className="size-4" />} />
          <div className="px-5 pb-4">{!data ? <Skeleton className="h-24" /> : <ActivityFeed events={data.activity} showEntity />}</div>
        </Card>
      </div>

      {data && (
        <p className="text-center text-[11px] text-faint">
          Analyzer: {data.system.analyzer === "groq" ? `Groq · ${data.system.model} (fallback ${data.system.fallbackModel})` : "rule-based fallback (set GROQ_API_KEY for LLM analysis)"} · Database:{" "}
          {data.system.database} · Market API: {data.system.publisher} · Up to {data.system.maxItemsPerRun} analyses per run
        </p>
      )}
    </div>
  );
}
