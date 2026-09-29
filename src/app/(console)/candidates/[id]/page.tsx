"use client";

import { ArrowLeft, Bot, Check, CheckCircle2, ChevronDown, Copy, GitCompare, History, Pencil, RotateCcw, Save, Store, X, XCircle } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { ActivityFeed } from "@/components/activity";
import { DefinitionEditor, DefinitionView } from "@/components/candidate/definition";
import { SourcesPanel } from "@/components/candidate/sources-panel";
import { ValidationPanel } from "@/components/candidate/validation-panel";
import { Badge, Button, Card, CardHeader, EmptyState, Modal, Skeleton, StatusBadge, Textarea } from "@/components/ui";
import type { CandidateDetailResponse } from "@/lib/api-types";
import { ApiError, apiFetch, fetcher } from "@/lib/client";
import type { Candidate, CandidateEditInput, CandidateStatus } from "@/lib/domain";
import { cn, formatDateTime, relativeTime } from "@/lib/format";
import { validateCandidate } from "@/lib/validation";

function toInput(c: Candidate): CandidateEditInput {
  return {
    question: c.question,
    category: c.category,
    description: c.description,
    outcomeType: c.outcomeType,
    outcomes: c.outcomes,
    eventDate: c.eventDate,
    closeDate: c.closeDate,
    resolutionCriteria: c.resolutionCriteria,
    resolutionSourceName: c.resolutionSourceName,
    resolutionSourceUrl: c.resolutionSourceUrl,
    tags: c.tags,
  };
}

const STEPS: { key: string; label: string }[] = [
  { key: "discovered", label: "Discovered" },
  { key: "validated", label: "Validated" },
  { key: "review", label: "Human review" },
  { key: "approved", label: "Approved" },
  { key: "market", label: "Market created" },
];

function Lifecycle({ status }: { status: CandidateStatus }) {
  const reached = status === "market_created" ? 5 : status === "approved" ? 4 : 3;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
      {STEPS.map((s, i) => {
        const done = i < reached;
        const current = i === reached - 1 && status !== "rejected";
        const rejected = status === "rejected" && i === 2;
        return (
          <div key={s.key} className="flex items-center gap-1.5">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
                rejected ? "border-bad/40 bg-bad/10 text-bad" : current ? "border-accent/50 bg-accent/15 text-[#c4b5ff]" : done ? "border-ok/30 bg-ok/5 text-ok" : "border-line text-faint",
              )}
            >
              {rejected ? <X className="size-3" /> : done && !current ? <Check className="size-3" /> : null}
              {rejected ? "Rejected" : s.label}
            </span>
            {i < STEPS.length - 1 && <span className="h-px w-3 bg-line-strong" />}
          </div>
        );
      })}
    </div>
  );
}

const REJECT_REASONS = ["Duplicate of an existing market", "Outcome cannot be verified objectively", "Subjective or ambiguous question", "Event date too uncertain", "Low trader interest", "Out of scope for OmniMarketX"];

export default function CandidateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, mutate, isLoading } = useSWR<CandidateDetailResponse>(`/api/candidates/${id}`, fetcher);
  const [draft, setDraft] = useState<CandidateEditInput | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [ack, setAck] = useState(false);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [showRaw, setShowRaw] = useState(false);

  const c = data?.candidate;
  const liveReport = useMemo(() => {
    if (!draft || !data) return null;
    return validateCandidate(draft, {
      sources: data.sources.map((s) => ({ url: s.url, publishedAt: s.publishedAt, reliability: s.sourceReliability, role: s.role, facts: s.facts, sourceName: s.sourceName })),
      similar: data.similar,
      ambiguityNotes: data.candidate.ambiguityNotes,
      confidence: data.candidate.confidence,
      generator: data.candidate.generator,
    });
  }, [draft, data]);

  if (error) {
    return (
      <Card>
        <EmptyState title={error instanceof ApiError && error.status === 404 ? "Candidate not found" : "Could not load candidate"} description={(error as Error).message} action={<Link href="/candidates"><Button>Back to queue</Button></Link>} />
      </Card>
    );
  }
  if (isLoading || !data || !c) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-20" />
        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  const report = liveReport ?? c.validation;
  const editable = c.status === "pending_review" || c.status === "approved";
  const conflict = c.validation.issues.some((i) => i.code === "CONFLICTING_SOURCES");
  const warnings = c.validation.issues.filter((i) => i.severity === "warning");

  function handleError(err: unknown) {
    if (err instanceof ApiError) {
      if (err.code === "VERSION_CONFLICT") {
        toast.error(err.message, { action: { label: "Reload", onClick: () => mutate() } });
      } else if (err.code === "VALIDATION_FAILED" && Array.isArray(err.details)) {
        const map: Record<string, string> = {};
        for (const d of err.details as { field: string; message: string }[]) map[d.field.split(".")[0]] = d.message;
        setFieldErrors(map);
        toast.error("Some fields are invalid.");
      } else {
        toast.error(err.message);
      }
    } else toast.error((err as Error).message);
  }

  async function save() {
    if (!draft || !c) return;
    const original = toInput(c);
    const changes: Partial<CandidateEditInput> = {};
    for (const k of Object.keys(draft) as (keyof CandidateEditInput)[]) {
      if (JSON.stringify(draft[k]) !== JSON.stringify(original[k])) (changes as Record<string, unknown>)[k] = draft[k];
    }
    if (Object.keys(changes).length === 0) {
      setDraft(null);
      return;
    }
    setBusy("save");
    setFieldErrors({});
    try {
      await apiFetch(`/api/candidates/${c.id}`, { method: "PATCH", body: { expectedVersion: c.version, changes } });
      toast.success(c.status === "approved" ? "Saved. The candidate went back to review because its content changed." : "Changes saved and re-validated.");
      setDraft(null);
      await mutate();
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(null);
    }
  }

  async function act(action: "approve" | "reject" | "reopen" | "market") {
    if (!c) return;
    setBusy(action);
    try {
      if (action === "approve") await apiFetch(`/api/candidates/${c.id}/approve`, { body: { expectedVersion: c.version, note: note || undefined, acknowledgeWarnings: ack } });
      if (action === "reject") await apiFetch(`/api/candidates/${c.id}/reject`, { body: { expectedVersion: c.version, reason } });
      if (action === "reopen") await apiFetch(`/api/candidates/${c.id}/reopen`, { body: { expectedVersion: c.version } });
      if (action === "market") {
        const r = await apiFetch<{ replay: boolean }>(`/api/candidates/${c.id}/market`, { method: "POST" });
        toast.success(r.replay ? "Market already existed — returned the original (idempotent)." : "Market created on OmniMarketX (mock API).");
      } else {
        toast.success(action === "approve" ? "Candidate approved." : action === "reject" ? "Candidate rejected." : "Candidate reopened for review.");
      }
      setApproveOpen(false);
      setRejectOpen(false);
      setAck(false);
      setNote("");
      setReason("");
      await mutate();
    } catch (err) {
      handleError(err);
      if (err instanceof ApiError && ["BLOCKING_ISSUES", "WARNINGS_NOT_ACKNOWLEDGED"].includes(err.code)) await mutate();
    } finally {
      setBusy(null);
    }
  }

  const analysis = data.analyses[0]?.analysis;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Link href="/candidates" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
          <ArrowLeft className="size-4" /> Review queue
        </Link>
        <span className="font-mono text-[11px] text-faint">
          {c.id} · v{c.version}
        </span>
      </div>

      {/* Header */}
      <Card className="relative overflow-hidden p-5 sm:p-6">
        <div className="pointer-events-none absolute -right-24 -top-24 size-64 rounded-full bg-accent/10 blur-3xl" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={c.status} />
              <Badge>{c.category}</Badge>
              {c.generator.startsWith("heuristic") ? <Badge tone="warn">heuristic draft</Badge> : <Badge tone="cyan"><Bot className="size-3" /> AI drafted</Badge>}
              {c.confidence != null && <Badge tone={c.confidence >= 0.7 ? "ok" : c.confidence >= 0.5 ? "neutral" : "warn"}>confidence {Math.round(c.confidence * 100)}%</Badge>}
            </div>
            <h1 className="mt-3 text-xl font-semibold leading-snug tracking-tight sm:text-2xl" data-testid="candidate-question">
              {c.question}
            </h1>
            {c.description && <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">{c.description}</p>}
            <div className="mt-4">
              <Lifecycle status={c.status} />
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2 lg:max-w-[340px] lg:justify-end">
            {c.status === "pending_review" && !draft && (
              <>
                <Button variant="danger" icon={<XCircle className="size-4" />} onClick={() => setRejectOpen(true)} data-testid="reject-btn">
                  Reject
                </Button>
                <Button
                  variant="success"
                  icon={<CheckCircle2 className="size-4" />}
                  onClick={() => setApproveOpen(true)}
                  disabled={c.validation.blockers > 0}
                  title={c.validation.blockers > 0 ? "Fix blocking issues first" : undefined}
                  data-testid="approve-btn"
                >
                  Approve
                </Button>
              </>
            )}
            {c.status === "approved" && !draft && (
              <>
                <Button variant="ghost" icon={<RotateCcw className="size-4" />} loading={busy === "reopen"} onClick={() => act("reopen")}>
                  Back to review
                </Button>
                <Button variant="primary" icon={<Store className="size-4" />} loading={busy === "market"} onClick={() => act("market")} data-testid="create-market-btn">
                  Create market
                </Button>
              </>
            )}
            {c.status === "rejected" && (
              <Button variant="outline" icon={<RotateCcw className="size-4" />} loading={busy === "reopen"} onClick={() => act("reopen")}>
                Reopen
              </Button>
            )}
            {editable && !draft && (
              <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setDraft(toInput(c))} data-testid="edit-btn">
                Edit
              </Button>
            )}
          </div>
        </div>
        {c.status === "pending_review" && c.validation.blockers > 0 && !draft && (
          <div className="relative mt-5 rounded-lg border border-bad/25 bg-bad/5 px-4 py-2.5 text-sm text-bad">
            {c.validation.blockers} blocking issue{c.validation.blockers > 1 ? "s" : ""} must be fixed before this can be approved. Edit the candidate or reject it.
          </div>
        )}
        {(c.status === "approved" || c.status === "rejected") && c.reviewedBy && (
          <div className={cn("relative mt-5 rounded-lg border px-4 py-2.5 text-sm", c.status === "approved" ? "border-ok/25 bg-ok/5 text-ok" : "border-bad/25 bg-bad/5 text-bad")}>
            {c.status === "approved" ? "Approved" : "Rejected"} by <b>{c.reviewedBy}</b> {relativeTime(c.reviewedAt)}
            {c.reviewNote && <span className="text-fg/80"> — “{c.reviewNote}”</span>}
            {c.status === "approved" && <span className="text-fg/70"> · Next step: create the market.</span>}
          </div>
        )}
        {data.market && (
          <div className="relative mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent/30 bg-accent/10 px-4 py-3 text-sm">
            <span>
              Market <span className="font-mono text-[#c4b5ff]">{data.market.externalId}</span> created by {data.market.createdBy} {relativeTime(data.market.createdAt)}.
            </span>
            <Link href={`/markets/${data.market.id}`}>
              <Button size="sm" variant="primary">
                View market
              </Button>
            </Link>
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          <Card className={cn(draft && "ring-1 ring-accent/40")}>
            <CardHeader
              title={draft ? "Editing market definition" : "Market definition"}
              description={draft ? "Checks on the right update as you type. The server re-validates on save." : "Structured candidate generated from the sources."}
              actions={
                draft && (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => (setDraft(null), setFieldErrors({}))}>
                      Cancel
                    </Button>
                    <Button variant="primary" size="sm" icon={<Save className="size-3.5" />} loading={busy === "save"} onClick={save} data-testid="save-btn">
                      Save changes
                    </Button>
                  </>
                )
              }
            />
            {draft ? <DefinitionEditor value={draft} onChange={setDraft} issues={report.issues} fieldErrors={fieldErrors} /> : <DefinitionView c={c} />}
          </Card>

          <SourcesPanel sources={data.sources} conflict={conflict} candidateEventDate={c.eventDate} />

          {analysis && (
            <Card>
              <CardHeader title="Analyzer output" description={`Raw draft from ${analysis.generator} — kept for auditing and debugging incorrect AI candidates.`} icon={<Bot className="size-4" />} />
              <div className="space-y-3 px-5 pb-5">
                {c.aiRationale && <p className="text-sm text-muted">“{c.aiRationale}”</p>}
                {c.ambiguityNotes.length > 0 && (
                  <ul className="space-y-1">
                    {c.ambiguityNotes.map((n, i) => (
                      <li key={i} className="text-xs text-warn">• {n}</li>
                    ))}
                  </ul>
                )}
                <button onClick={() => setShowRaw((s) => !s)} className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg">
                  <ChevronDown className={cn("size-3.5 transition-transform", showRaw && "rotate-180")} /> {showRaw ? "Hide" : "Show"} raw JSON
                </button>
                {showRaw && (
                  <pre className="scrollbar-thin max-h-80 overflow-auto rounded-lg border border-line bg-[#090b10] p-3 font-mono text-[11px] leading-relaxed text-muted">
                    {JSON.stringify(analysis.draft, null, 2)}
                  </pre>
                )}
              </div>
            </Card>
          )}
        </div>

        <div className="min-w-0 space-y-6">
          <ValidationPanel report={report} live={!!draft} />

          <Card>
            <CardHeader title="Similar markets & candidates" description="Lexical similarity, adjusted for different dates" icon={<GitCompare className="size-4" />} />
            <div className="space-y-1 px-3 pb-3">
              {data.similar.length === 0 ? (
                <p className="px-2 pb-2 text-sm text-faint">No similar items found.</p>
              ) : (
                data.similar.map((s) => (
                  <Link
                    key={`${s.kind}-${s.id}`}
                    href={s.kind === "market" ? `/markets/${s.id}` : `/candidates/${s.id}`}
                    className="flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-panel-2"
                  >
                    <span className={cn("mt-0.5 shrink-0 rounded px-1.5 py-px font-mono text-[11px]", s.similarity >= 0.72 ? "bg-bad/15 text-bad" : s.similarity >= 0.5 ? "bg-warn/15 text-warn" : "bg-panel-3 text-muted")}>
                      {Math.round(s.similarity * 100)}%
                    </span>
                    <div className="min-w-0">
                      <div className="line-clamp-2 text-[13px]">{s.question}</div>
                      <div className="mt-0.5 text-[11px] text-faint">
                        {s.kind} · {s.status.replace(/_/g, " ")}
                      </div>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Activity & revisions" icon={<History className="size-4" />} />
            <div className="space-y-5 px-5 pb-5">
              <ActivityFeed events={data.activity} />
              {data.revisions.length > 0 && (
                <div>
                  <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-faint">Edit history</div>
                  <div className="space-y-2">
                    {data.revisions.map((r) => (
                      <details key={r.id} className="group rounded-lg border border-line bg-panel-2/40 px-3 py-2">
                        <summary className="cursor-pointer list-none text-xs text-muted">
                          <span className="font-mono text-fg">v{r.version}</span> · {r.changedBy} · {Object.keys(r.changes).join(", ")} · {relativeTime(r.createdAt)}
                        </summary>
                        <div className="mt-2 space-y-2">
                          {Object.entries(r.changes).map(([field, ch]) => (
                            <div key={field} className="text-[11px]">
                              <div className="font-medium text-muted">{field}</div>
                              <div className="mt-0.5 rounded bg-bad/10 px-2 py-1 font-mono text-bad/90 line-through decoration-bad/40">{JSON.stringify(ch.from)}</div>
                              <div className="mt-0.5 rounded bg-ok/10 px-2 py-1 font-mono text-ok/90">{JSON.stringify(ch.to)}</div>
                            </div>
                          ))}
                        </div>
                      </details>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Card>
          <p className="text-center text-[11px] text-faint">
            Created {formatDateTime(c.createdAt)} · event key <span className="font-mono">{c.eventKey}</span>
            <button
              className="ml-1 inline-flex align-middle text-faint hover:text-fg"
              title="Copy candidate id"
              onClick={() => navigator.clipboard?.writeText(c.id).then(() => toast.success("Copied candidate id"))}
            >
              <Copy className="size-3" />
            </button>
          </p>
        </div>
      </div>

      <Modal
        open={approveOpen}
        onClose={() => setApproveOpen(false)}
        title="Approve candidate"
        description="Approval records your name and allows the market to be created. It does not publish anything yet."
        footer={
          <>
            <Button variant="ghost" onClick={() => setApproveOpen(false)}>
              Cancel
            </Button>
            <Button variant="success" loading={busy === "approve"} disabled={warnings.length > 0 && !ack} onClick={() => act("approve")} data-testid="confirm-approve">
              Approve
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-line bg-panel-2/60 p-3 text-sm font-medium">{c.question}</div>
          {warnings.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-warn">{warnings.length} warning(s) to acknowledge</div>
              <ul className="space-y-1.5">
                {warnings.map((w, i) => (
                  <li key={i} className="rounded-md border border-warn/20 bg-warn/5 px-3 py-2 text-xs text-fg/90">
                    {w.message}
                  </li>
                ))}
              </ul>
              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line px-3 py-2.5 text-sm">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 size-4 accent-[#8b6cff]" data-testid="ack-warnings" />
                I have reviewed these warnings and the market is still clear, verifiable and resolvable.
              </label>
            </div>
          )}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted" htmlFor="note">
              Review note (optional)
            </label>
            <Textarea id="note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Confirmed date on official calendar." />
          </div>
        </div>
      </Modal>

      <Modal
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title="Reject candidate"
        description="Rejected candidates stay in the system so the same event is not re-proposed by later discovery runs."
        footer={
          <>
            <Button variant="ghost" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={busy === "reject"} disabled={reason.trim().length < 3} onClick={() => act("reject")} data-testid="confirm-reject">
              Reject
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {REJECT_REASONS.map((r) => (
              <button
                key={r}
                onClick={() => setReason(r)}
                className={cn("rounded-full border px-2.5 py-1 text-xs transition-colors", reason === r ? "border-bad/50 bg-bad/10 text-bad" : "border-line text-muted hover:text-fg")}
              >
                {r}
              </button>
            ))}
          </div>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for rejection (required)" data-testid="reject-reason" />
        </div>
      </Modal>
    </div>
  );
}
