"use client";

import { AlertTriangle, ArrowRight, CheckCircle2, CircleDashed, GitMerge, Loader2, Play, Radar, Sparkles, XCircle } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import type { RunStats } from "@/lib/domain";
import { cn } from "@/lib/format";
import { Badge, Button, Card } from "./ui";

type Event =
  | { type: "run_started"; runId: string; analyzer: string; sources: number }
  | { type: "log"; level: "info" | "warn" | "error"; message: string }
  | { type: "source"; sourceId: string; name: string; ok: boolean; fetched: number; fresh: number; error?: string }
  | { type: "item"; itemId: string; title: string; status: string; reason?: string; candidateId?: string }
  | { type: "candidate"; candidateId: string; question: string; score: number; merged: boolean }
  | { type: "run_finished"; runId: string; status: string; stats: RunStats };

interface Line {
  id: number;
  icon: "ok" | "fail" | "spin" | "new" | "merge" | "warn" | "info" | "skip";
  text: string;
  sub?: string;
  href?: string;
  score?: number;
}

export function useDiscoveryRun() {
  const { mutate } = useSWRConfig();
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [finished, setFinished] = useState<{ runId: string; status: string; stats: RunStats } | null>(null);
  const [created, setCreated] = useState<string[]>([]);
  const counter = useRef(0);

  const push = useCallback((l: Omit<Line, "id">) => setLines((prev) => [...prev, { ...l, id: counter.current++ }]), []);

  const start = useCallback(async () => {
    setRunning(true);
    setLines([]);
    setFinished(null);
    setCreated([]);
    try {
      const res = await fetch("/api/discovery/run", { method: "POST", credentials: "same-origin" });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        toast.error(body?.error?.message ?? `Could not start discovery (${res.status})`);
        setRunning(false);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const raw = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!raw) continue;
          let e: Event;
          try {
            e = JSON.parse(raw) as Event;
          } catch {
            continue;
          }
          switch (e.type) {
            case "run_started":
              push({ icon: "info", text: `Run started · ${e.sources} sources · analyzer: ${e.analyzer}` });
              break;
            case "source":
              push(
                e.ok
                  ? { icon: "ok", text: e.name, sub: `${e.fetched} items · ${e.fresh} new` }
                  : { icon: "fail", text: e.name, sub: e.error },
              );
              break;
            case "item":
              if (e.status === "analyzing") push({ icon: "spin", text: `Analyzing: ${e.title}` });
              else if (e.status === "unsuitable") push({ icon: "skip", text: `Not a market: ${e.title}`, sub: e.reason });
              else if (e.status === "failed") push({ icon: "fail", text: `Failed: ${e.title}`, sub: e.reason });
              break;
            case "candidate":
              if (!e.merged) setCreated((c) => [...c, e.candidateId]);
              push({
                icon: e.merged ? "merge" : "new",
                text: e.merged ? `Evidence added to: ${e.question}` : e.question,
                sub: e.merged ? "Matched an existing candidate — merged instead of duplicating" : "New candidate created",
                href: `/candidates/${e.candidateId}`,
                score: e.score,
              });
              break;
            case "log":
              if (e.level !== "info") push({ icon: e.level === "error" ? "fail" : "warn", text: e.message });
              else if (/deferred|Analyzing \d/.test(e.message)) push({ icon: "info", text: e.message });
              break;
            case "run_finished":
              setFinished({ runId: e.runId, status: e.status, stats: e.stats });
              break;
          }
        }
      }
    } catch (err) {
      toast.error(`Discovery stream interrupted: ${(err as Error).message}`);
    } finally {
      setRunning(false);
      mutate((key) => typeof key === "string" && key.startsWith("/api/"), undefined, { revalidate: true });
    }
  }, [mutate, push]);

  useEffect(() => {
    if (finished) {
      const s = finished.stats;
      const msg = `${s.candidatesCreated} new candidate${s.candidatesCreated === 1 ? "" : "s"}, ${s.candidatesMerged} merged`;
      if (finished.status === "completed") toast.success(`Discovery complete — ${msg}`);
      else if (finished.status === "completed_with_errors") toast.warning(`Discovery finished with errors — ${msg}`);
      else toast.error("Discovery run failed");
    }
  }, [finished]);

  return { running, lines, finished, created, start };
}

const ICONS: Record<Line["icon"], React.ReactNode> = {
  ok: <CheckCircle2 className="size-4 text-ok" />,
  fail: <XCircle className="size-4 text-bad" />,
  spin: <Loader2 className="size-4 animate-spin text-accent" />,
  new: <Sparkles className="size-4 text-accent" />,
  merge: <GitMerge className="size-4 text-cyan" />,
  warn: <AlertTriangle className="size-4 text-warn" />,
  info: <CircleDashed className="size-4 text-faint" />,
  skip: <CircleDashed className="size-4 text-faint" />,
};

export function DiscoveryConsole({ run }: { run: ReturnType<typeof useDiscoveryRun> }) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [run.lines.length]);

  if (!run.running && run.lines.length === 0) return null;
  const s = run.finished?.stats;
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          {run.running ? <Loader2 className="size-4 animate-spin text-accent" /> : <Radar className="size-4 text-accent" />}
          {run.running ? "Discovery in progress…" : "Last run"}
        </div>
        {run.finished && (
          <Badge tone={run.finished.status === "completed" ? "ok" : run.finished.status === "failed" ? "bad" : "warn"} dot>
            {run.finished.status.replace(/_/g, " ")}
          </Badge>
        )}
      </div>
      <div ref={scroller} className="scrollbar-thin max-h-[380px] space-y-0.5 overflow-y-auto bg-[#090b10] px-3 py-3 font-mono text-[12.5px]" data-testid="discovery-log">
        {run.lines.map((l) => (
          <div key={l.id} className="flex animate-fade-in items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-panel-2">
            <span className="mt-px shrink-0">{ICONS[l.icon]}</span>
            <div className="min-w-0 flex-1">
              {l.href ? (
                <Link href={l.href} className="text-fg hover:text-accent hover:underline">
                  {l.text}
                </Link>
              ) : (
                <span className={cn(l.icon === "fail" ? "text-bad" : l.icon === "warn" ? "text-warn" : "text-fg/90")}>{l.text}</span>
              )}
              {l.sub && <div className="truncate text-[11px] text-faint">{l.sub}</div>}
            </div>
            {l.score !== undefined && <span className="shrink-0 rounded bg-panel-3 px-1.5 text-[11px] text-muted">q{l.score}</span>}
          </div>
        ))}
      </div>
      {s && (
        <div className="grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-5">
          {[
            ["Sources ok / failed", `${s.sourcesOk} / ${s.sourcesFailed}`],
            ["New items", s.itemsNew],
            ["Analyzed", s.itemsAnalyzed],
            ["New candidates", s.candidatesCreated],
            ["Merged", s.candidatesMerged],
          ].map(([label, value]) => (
            <div key={label as string} className="bg-panel px-4 py-3">
              <div className="text-[11px] text-faint">{label}</div>
              <div className="font-mono text-lg font-semibold tabular-nums">{value}</div>
            </div>
          ))}
        </div>
      )}
      {run.finished && run.created.length > 0 && (
        <div className="flex items-center justify-between border-t border-line px-5 py-3">
          <span className="text-sm text-muted">{run.created.length} candidate(s) waiting for human review.</span>
          <Link href="/candidates">
            <Button variant="primary" size="sm" icon={<ArrowRight className="size-3.5" />}>
              Open review queue
            </Button>
          </Link>
        </div>
      )}
    </Card>
  );
}

export function RunDiscoveryButton({ run, size = "md" }: { run: ReturnType<typeof useDiscoveryRun>; size?: "md" | "lg" }) {
  return (
    <Button variant="primary" size={size} onClick={run.start} loading={run.running} icon={!run.running && <Play className="size-4" />} data-testid="run-discovery">
      {run.running ? "Running discovery…" : "Run discovery"}
    </Button>
  );
}
