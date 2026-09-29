"use client";

import { CalendarClock, ChevronRight, FileStack, Inbox, Search } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import useSWR from "swr";
import { Badge, Card, EmptyState, Input, PageHeader, ScoreRing, Select, Skeleton, StatusBadge, Tabs } from "@/components/ui";
import type { CandidateListResponse } from "@/lib/api-types";
import { fetcher } from "@/lib/client";
import { CATEGORIES, type CandidateStatus } from "@/lib/domain";
import { formatDate, relativeTime } from "@/lib/format";

type TabValue = CandidateStatus | "all";

function QueueInner() {
  const router = useRouter();
  const params = useSearchParams();
  const status = (params.get("status") as TabValue) ?? "pending_review";
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [debounced, setDebounced] = useState(search);
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState("score");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const qs = new URLSearchParams({ status, sort, ...(debounced ? { q: debounced } : {}), ...(category ? { category } : {}) });
  const { data, isLoading } = useSWR<CandidateListResponse>(`/api/candidates?${qs}`, fetcher, { keepPreviousData: true });
  const counts = data?.counts ?? {};
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Validate · Review"
        title="Review queue"
        description="Every candidate needs a human decision. Blocking issues must be fixed before approval; warnings must be explicitly acknowledged."
      />
      <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
        <Tabs<TabValue>
          value={status}
          onChange={(v) => router.replace(`/candidates?status=${v}`, { scroll: false })}
          items={[
            { value: "pending_review", label: "Pending review", count: counts.pending_review ?? 0 },
            { value: "approved", label: "Approved", count: counts.approved ?? 0 },
            { value: "market_created", label: "Market created", count: counts.market_created ?? 0 },
            { value: "rejected", label: "Rejected", count: counts.rejected ?? 0 },
            { value: "all", label: "All", count: total },
          ]}
        />
        <div className="flex flex-wrap gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search questions…" className="w-60 pl-9" aria-label="Search candidates" />
          </div>
          <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-44" aria-label="Category">
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
          <Select value={sort} onChange={(e) => setSort(e.target.value)} className="w-40" aria-label="Sort">
            <option value="score">Best quality</option>
            <option value="newest">Newest</option>
            <option value="closing">Closing soonest</option>
          </Select>
        </div>
      </div>

      <Card className="overflow-hidden">
        {isLoading && !data ? (
          <div className="space-y-2 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}</div>
        ) : data && data.candidates.length === 0 ? (
          <EmptyState
            icon={<Inbox className="size-5" />}
            title={status === "pending_review" ? "Nothing waiting for review" : "No candidates here"}
            description={status === "pending_review" ? "Run discovery from the dashboard to generate new candidates." : "Try another tab or clear the filters."}
          />
        ) : (
          <ul className="divide-y divide-line" data-testid="candidate-list">
            {data?.candidates.map((c) => (
              <li key={c.id}>
                <Link href={`/candidates/${c.id}`} className="group flex items-center gap-4 px-4 py-4 transition-colors hover:bg-panel-2 sm:px-5">
                  <ScoreRing score={c.validation.score} size={46} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={c.status} />
                      <Badge>{c.category}</Badge>
                      {c.generator.startsWith("heuristic") ? <Badge tone="warn">heuristic</Badge> : <Badge tone="cyan">AI drafted</Badge>}
                    </div>
                    <div className="mt-1.5 line-clamp-2 text-[15px] font-medium leading-snug group-hover:text-white">{c.question}</div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint">
                      <span className="inline-flex items-center gap-1">
                        <CalendarClock className="size-3.5" /> closes {formatDate(c.closeDate)} ({relativeTime(c.closeDate)})
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <FileStack className="size-3.5" /> {c.sourceCount} source{c.sourceCount === 1 ? "" : "s"}
                      </span>
                      <span>found {relativeTime(c.createdAt)}</span>
                    </div>
                  </div>
                  <div className="hidden shrink-0 flex-col items-end gap-1.5 sm:flex">
                    {c.validation.blockers > 0 && <Badge tone="bad">{c.validation.blockers} blocking</Badge>}
                    {c.validation.warnings > 0 && <Badge tone="warn">{c.validation.warnings} warning{c.validation.warnings > 1 ? "s" : ""}</Badge>}
                    {c.validation.blockers === 0 && c.validation.warnings === 0 && <Badge tone="ok">clean</Badge>}
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-faint group-hover:text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export default function CandidatesPage() {
  return (
    <Suspense>
      <QueueInner />
    </Suspense>
  );
}
