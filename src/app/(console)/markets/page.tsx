"use client";

import { CalendarClock, ChevronRight, FileStack, Store } from "lucide-react";
import Link from "next/link";
import useSWR from "swr";
import { Badge, Card, EmptyState, PageHeader, Skeleton } from "@/components/ui";
import { fetcher } from "@/lib/client";
import type { Market } from "@/lib/domain";
import { formatDate, relativeTime } from "@/lib/format";

function MarketCard({ m }: { m: Market }) {
  return (
    <Link href={`/markets/${m.id}`} className="group block">
      <Card className="h-full p-5 transition-colors group-hover:border-line-strong">
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            <Badge tone={m.isSeed ? "neutral" : "accent"} dot>
              {m.isSeed ? "existing" : m.status}
            </Badge>
            <Badge>{m.category}</Badge>
          </div>
          <span className="font-mono text-[10px] text-faint">{m.externalId}</span>
        </div>
        <div className="mt-3 line-clamp-3 text-[15px] font-medium leading-snug group-hover:text-white">{m.question}</div>
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint">
          <span className="inline-flex items-center gap-1">
            <CalendarClock className="size-3.5" /> closes {formatDate(m.payload.closesAt)}
          </span>
          {!m.isSeed && (
            <span className="inline-flex items-center gap-1">
              <FileStack className="size-3.5" /> {m.payload.provenance.sources.length} source(s)
            </span>
          )}
          <span className="ml-auto inline-flex items-center gap-1">
            {m.isSeed ? "seed data" : `by ${m.createdBy} · ${relativeTime(m.createdAt)}`}
            <ChevronRight className="size-3.5" />
          </span>
        </div>
      </Card>
    </Link>
  );
}

export default function MarketsPage() {
  const { data, isLoading } = useSWR<{ markets: Market[] }>("/api/markets", fetcher);
  const created = data?.markets.filter((m) => !m.isSeed) ?? [];
  const seed = data?.markets.filter((m) => m.isSeed) ?? [];
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Create"
        title="Markets"
        description="Structured markets created through the OmniMarketX market API boundary (mock service in this demo). Each carries the full provenance of its candidate."
      />
      <section>
        <h2 className="mb-3 text-sm font-semibold">Created from approved candidates</h2>
        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-40" />)}</div>
        ) : created.length === 0 ? (
          <Card>
            <EmptyState icon={<Store className="size-5" />} title="No markets created yet" description="Approve a candidate in the review queue, then press “Create market”." />
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="market-list">
            {created.map((m) => (
              <MarketCard key={m.id} m={m} />
            ))}
          </div>
        )}
      </section>
      {seed.length > 0 && (
        <section>
          <h2 className="mb-1 text-sm font-semibold">Already live on OmniMarketX</h2>
          <p className="mb-3 text-xs text-muted">Seed markets used by duplicate detection — new candidates that match these are blocked.</p>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {seed.map((m) => (
              <MarketCard key={m.id} m={m} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
