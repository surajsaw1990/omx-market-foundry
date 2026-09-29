"use client";

import { ArrowLeft, Braces, Copy, ExternalLink, FileStack, History, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import useSWR from "swr";
import { ActivityFeed } from "@/components/activity";
import { Badge, Button, Card, CardHeader, EmptyState, Skeleton } from "@/components/ui";
import { fetcher } from "@/lib/client";
import type { AuditEvent, Market } from "@/lib/domain";
import { formatDateTime, hostname, relativeTime } from "@/lib/format";

export default function MarketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error } = useSWR<{ market: Market; activity: AuditEvent[] }>(`/api/markets/${id}`, fetcher);
  if (error) return <Card><EmptyState title="Market not found" description={(error as Error).message} /></Card>;
  if (!data) return <Skeleton className="h-96" />;
  const { market: m, activity } = data;
  const p = m.payload;
  const json = JSON.stringify(p, null, 2);

  return (
    <div className="space-y-6">
      <Link href="/markets" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Markets
      </Link>
      <Card className="relative overflow-hidden p-6">
        <div className="pointer-events-none absolute -right-24 -top-24 size-64 rounded-full bg-accent/10 blur-3xl" />
        <div className="relative">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={m.isSeed ? "neutral" : "accent"} dot>{m.isSeed ? "existing (seed)" : m.status}</Badge>
            <Badge>{p.category}</Badge>
            <Badge tone="info">{p.marketType}</Badge>
            <span className="font-mono text-[11px] text-faint">{m.externalId}</span>
          </div>
          <h1 className="mt-3 text-2xl font-semibold leading-snug tracking-tight" data-testid="market-title">{p.title}</h1>
          {p.description && <p className="mt-2 max-w-3xl text-sm text-muted">{p.description}</p>}
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Outcomes", p.outcomes.map((o) => o.label).join(" / ")],
              ["Trading closes", formatDateTime(p.closesAt)],
              ["Expected resolution", formatDateTime(p.expectedResolutionAt)],
              ["Created", m.isSeed ? "seed data" : `${m.createdBy} · ${relativeTime(m.createdAt)}`],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-line bg-panel-2/50 px-3 py-2.5">
                <div className="text-[11px] text-faint">{k}</div>
                <div className="mt-0.5 text-sm font-medium">{v}</div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Resolution" icon={<ShieldCheck className="size-4" />} />
            <div className="space-y-3 px-5 pb-5 text-sm">
              <p className="leading-relaxed text-fg/90">{p.resolution.criteria}</p>
              {p.resolution.source.url && (
                <a href={p.resolution.source.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1.5 text-accent hover:underline">
                  {p.resolution.source.name} ({hostname(p.resolution.source.url)}) <ExternalLink className="size-3" />
                </a>
              )}
            </div>
          </Card>
          <Card>
            <CardHeader
              title="Market payload"
              description="Exactly what was sent to the OmniMarketX market API (POST /v1/markets, Idempotency-Key = candidate id)."
              icon={<Braces className="size-4" />}
              actions={
                <Button size="sm" variant="ghost" icon={<Copy className="size-3.5" />} onClick={() => navigator.clipboard?.writeText(json).then(() => toast.success("Payload copied"))}>
                  Copy
                </Button>
              }
            />
            <pre className="scrollbar-thin mx-5 mb-5 max-h-[480px] overflow-auto rounded-lg border border-line bg-[#090b10] p-4 font-mono text-[11.5px] leading-relaxed text-muted" data-testid="market-payload">
              {json}
            </pre>
          </Card>
        </div>
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Provenance" description="Sources that survived from discovery into the market" icon={<FileStack className="size-4" />} />
            <div className="space-y-2 px-5 pb-5">
              {p.provenance.sources.length === 0 && <p className="text-sm text-faint">No sources (seed market).</p>}
              {p.provenance.sources.map((s) => (
                <a key={s.url} href={s.url} target="_blank" rel="noreferrer noopener" className="block rounded-lg border border-line bg-panel-2/40 px-3 py-2.5 hover:border-line-strong" data-testid="provenance-source">
                  <div className="text-[13px] font-medium leading-snug">{s.title}</div>
                  <div className="mt-1 text-[11px] text-faint">
                    {s.publisher} · {hostname(s.url)} · {relativeTime(s.publishedAt)}
                  </div>
                </a>
              ))}
              {!m.isSeed && (
                <div className="pt-2 text-[11px] text-faint">
                  Candidate <Link href={`/candidates/${p.provenance.candidateId}`} className="font-mono text-muted underline underline-offset-2">{p.provenance.candidateId}</Link> v{p.provenance.candidateVersion} · approved by{" "}
                  {p.provenance.approvedBy} · generator {p.provenance.generator}
                </div>
              )}
            </div>
          </Card>
          {!m.isSeed && (
            <Card>
              <CardHeader title="Lifecycle" icon={<History className="size-4" />} />
              <div className="px-5 pb-5">
                <ActivityFeed events={activity} />
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
