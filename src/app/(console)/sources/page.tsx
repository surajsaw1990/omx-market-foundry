"use client";

import { FlaskConical, Plus, Rss, Trash2, Zap } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { ReliabilityBadge } from "@/components/candidate/sources-panel";
import { Badge, Button, Card, CardHeader, Field, Input, Modal, PageHeader, Select, Skeleton, Switch } from "@/components/ui";
import { apiFetch, ApiError, fetcher } from "@/lib/client";
import { CATEGORIES, RELIABILITY_TIERS, type Source } from "@/lib/domain";
import { cn, hostname, relativeTime } from "@/lib/format";

interface TestResult {
  ok: boolean;
  ms: number;
  count?: number;
  error?: string;
  items?: { title: string; url: string; publishedAt: string | null; prefilter: { score: number; reasons: string[] } }[];
}

export default function SourcesPage() {
  const { data, mutate, isLoading } = useSWR<{ sources: Source[] }>("/api/sources", fetcher);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", url: "", reliability: "major_media", categoryHint: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [test, setTest] = useState<{ source: Source; result: TestResult | null } | null>(null);

  async function toggle(s: Source, enabled: boolean) {
    mutate({ sources: data!.sources.map((x) => (x.id === s.id ? { ...x, enabled } : x)) }, { revalidate: false });
    try {
      await apiFetch(`/api/sources/${s.id}`, { method: "PATCH", body: { enabled } });
      toast.success(`${s.name} ${enabled ? "enabled" : "disabled"}`);
    } catch (err) {
      toast.error((err as Error).message);
    }
    mutate();
  }

  async function runTest(s: Source) {
    setTest({ source: s, result: null });
    try {
      setTest({ source: s, result: await apiFetch<TestResult>(`/api/sources/${s.id}/test`, { method: "POST" }) });
    } catch (err) {
      setTest({ source: s, result: { ok: false, ms: 0, error: (err as Error).message } });
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy("add");
    setFormError(null);
    try {
      await apiFetch("/api/sources", { body: { name: form.name, url: form.url, reliability: form.reliability, categoryHint: form.categoryHint || null } });
      toast.success("Source added. It will be fetched on the next discovery run.");
      setAdding(false);
      setForm({ name: "", url: "", reliability: "major_media", categoryHint: "" });
      mutate();
    } catch (err) {
      setFormError(err instanceof ApiError && Array.isArray(err.details) ? (err.details as { field: string; message: string }[]).map((d) => `${d.field}: ${d.message}`).join("; ") : (err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function remove(s: Source) {
    if (!confirm(`Delete source “${s.name}” and its ingested items?`)) return;
    try {
      await apiFetch(`/api/sources/${s.id}`, { method: "DELETE" });
      toast.success("Source deleted");
      mutate();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Configuration"
        title="Sources"
        description="Public, legally accessible feeds the discovery pipeline reads. Reliability tiers feed into validation (weak single sources are flagged)."
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
            Add RSS source
          </Button>
        }
      />
      <Card className="overflow-hidden">
        <CardHeader title={`${data?.sources.filter((s) => s.enabled).length ?? "–"} enabled of ${data?.sources.length ?? "–"} sources`} icon={<Rss className="size-4" />} />
        <div className="divide-y divide-line border-t border-line">
          {isLoading && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="m-4 h-12" />)}
          {data?.sources.map((s) => (
            <div key={s.id} className={cn("grid items-center gap-3 px-5 py-3.5 md:grid-cols-[auto_1fr_auto]", !s.enabled && "opacity-60")} data-testid="source-row">
              <Switch checked={s.enabled} onChange={(v) => toggle(s, v)} label={`Enable ${s.name}`} />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{s.name}</span>
                  <ReliabilityBadge tier={s.reliability} />
                  {s.categoryHint && <Badge>{s.categoryHint}</Badge>}
                  {s.type === "fixture" && (
                    <Badge tone="warn">
                      <FlaskConical className="size-3" /> fixture
                    </Badge>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-faint">
                  <span className="font-mono">{s.type === "fixture" ? "bundled synthetic articles" : hostname(s.url)}</span>
                  <span>{s.itemCount} items ingested</span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className={cn("size-1.5 rounded-full", s.lastStatus === "ok" ? "bg-ok" : s.lastStatus === "error" ? "bg-bad" : "bg-line-strong")} />
                    {s.lastFetchedAt ? `fetched ${relativeTime(s.lastFetchedAt)}` : "never fetched"}
                  </span>
                  {s.consecutiveFailures > 0 && <span className="text-bad">{s.consecutiveFailures} consecutive failure(s)</span>}
                </div>
                {s.lastStatus === "error" && s.lastError && <div className="mt-1 truncate text-[11px] text-bad/90">{s.lastError}</div>}
              </div>
              <div className="flex gap-1.5">
                <Button size="sm" variant="outline" icon={<Zap className="size-3.5" />} onClick={() => runTest(s)}>
                  Test
                </Button>
                {s.type !== "fixture" && (
                  <Button size="sm" variant="ghost" onClick={() => remove(s)} aria-label={`Delete ${s.name}`}>
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="Add RSS / Atom source"
        description="Use public feeds you are allowed to read. Items are stored with their URL for provenance."
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy === "add"} onClick={add}>
              Add source
            </Button>
          </>
        }
      >
        <form onSubmit={add} className="space-y-4">
          <Field label="Name" htmlFor="sn">
            <Input id="sn" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Reuters — Markets" />
          </Field>
          <Field label="Feed URL" htmlFor="su" error={formError ?? undefined}>
            <Input id="su" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://example.com/feed.xml" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Reliability" htmlFor="sr">
              <Select id="sr" value={form.reliability} onChange={(e) => setForm({ ...form, reliability: e.target.value })}>
                {RELIABILITY_TIERS.filter((t) => t !== "synthetic").map((t) => (
                  <option key={t} value={t}>
                    {t.replace("_", " ")}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Category hint" htmlFor="sc">
              <Select id="sc" value={form.categoryHint} onChange={(e) => setForm({ ...form, categoryHint: e.target.value })}>
                <option value="">None</option>
                {CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
          </div>
          <button type="submit" className="hidden" />
        </form>
      </Modal>

      <Modal open={!!test} onClose={() => setTest(null)} title={`Test fetch · ${test?.source.name ?? ""}`} description="Dry run: fetches and parses the feed and shows prefilter scores. Nothing is stored." size="lg">
        {!test?.result ? (
          <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : !test.result.ok ? (
          <div className="rounded-lg border border-bad/30 bg-bad/5 p-4 text-sm text-bad">
            Fetch failed after {test.result.ms}ms: {test.result.error}
            <p className="mt-2 text-xs text-muted">During discovery this source would be marked unhealthy and skipped; other sources continue normally.</p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted">
              {test.result.count} items in {test.result.ms}ms. Showing the first {test.result.items?.length}.
            </p>
            {test.result.items?.map((it) => (
              <div key={it.url} className="rounded-lg border border-line bg-panel-2/40 px-3 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <a href={it.url} target="_blank" rel="noreferrer noopener" className="text-sm font-medium hover:text-accent">
                    {it.title}
                  </a>
                  <span className={cn("shrink-0 rounded px-1.5 font-mono text-[11px]", it.prefilter.score >= 0.3 ? "bg-ok/15 text-ok" : "bg-panel-3 text-faint")}>{it.prefilter.score.toFixed(2)}</span>
                </div>
                <div className="mt-1 text-[11px] text-faint">{it.prefilter.reasons.join(" · ") || "no market signals"}</div>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
