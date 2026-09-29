"use client";

import { CalendarClock, CalendarDays, ExternalLink, Gavel, Link2, ListChecks, Plus, Tag, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { CATEGORIES, type Candidate, type CandidateEditInput, type ValidationIssue } from "@/lib/domain";
import { cn, formatDateTime, fromLocalInput, hostname, relativeTime, toLocalInput } from "@/lib/format";
import { Badge, Button, Field, Input, Select, Textarea } from "../ui";

function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-line/70 py-3.5 last:border-0 sm:grid-cols-[170px_1fr] sm:gap-4">
      <div className="flex items-center gap-2 text-xs font-medium text-faint">
        {icon}
        {label}
      </div>
      <div className="min-w-0 text-sm">{children}</div>
    </div>
  );
}

export function DefinitionView({ c }: { c: Candidate }) {
  return (
    <div className="px-5 pb-2">
      <Row icon={<ListChecks className="size-3.5" />} label="Outcomes">
        <div className="flex flex-wrap gap-1.5">
          {c.outcomes.map((o) => (
            <span key={o.label} className="rounded-md border border-line-strong bg-panel-3 px-2 py-0.5 text-[13px]">
              {o.label}
            </span>
          ))}
          <span className="self-center text-xs text-faint">({c.outcomeType})</span>
        </div>
      </Row>
      <Row icon={<CalendarDays className="size-3.5" />} label="Event / resolution">
        {c.eventDate ? (
          <span>
            {formatDateTime(c.eventDate)} <span className="text-faint">· {relativeTime(c.eventDate)}</span>
          </span>
        ) : (
          <span className="text-bad">Not set</span>
        )}
      </Row>
      <Row icon={<CalendarClock className="size-3.5" />} label="Trading closes">
        {c.closeDate ? (
          <span>
            {formatDateTime(c.closeDate)} <span className="text-faint">· {relativeTime(c.closeDate)}</span>
          </span>
        ) : (
          <span className="text-bad">Not set</span>
        )}
      </Row>
      <Row icon={<Gavel className="size-3.5" />} label="Resolution criteria">
        <p className="whitespace-pre-line leading-relaxed text-fg/90">{c.resolutionCriteria || <span className="text-bad">Missing</span>}</p>
      </Row>
      <Row icon={<Link2 className="size-3.5" />} label="Resolution source">
        {c.resolutionSourceUrl ? (
          <a href={c.resolutionSourceUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1.5 text-accent hover:underline">
            {c.resolutionSourceName || hostname(c.resolutionSourceUrl)} <span className="text-faint">({hostname(c.resolutionSourceUrl)})</span>
            <ExternalLink className="size-3" />
          </a>
        ) : (
          <span className={c.resolutionSourceName ? "" : "text-bad"}>{c.resolutionSourceName || "Missing"}</span>
        )}
      </Row>
      <Row icon={<Tag className="size-3.5" />} label="Tags">
        <div className="flex flex-wrap gap-1.5">
          {c.tags.length ? c.tags.map((t) => <Badge key={t}>#{t}</Badge>) : <span className="text-faint">None</span>}
        </div>
      </Row>
    </div>
  );
}

function issuesFor(issues: ValidationIssue[], field: string) {
  return issues.filter((i) => i.field === field);
}

export function DefinitionEditor({
  value,
  onChange,
  issues,
  fieldErrors,
}: {
  value: CandidateEditInput;
  onChange: (v: CandidateEditInput) => void;
  issues: ValidationIssue[];
  fieldErrors: Record<string, string>;
}) {
  const set = <K extends keyof CandidateEditInput>(key: K, v: CandidateEditInput[K]) => onChange({ ...value, [key]: v });
  return (
    <div className="space-y-5 px-5 pb-5" data-testid="candidate-editor">
      <Field label="Question" htmlFor="q" error={fieldErrors.question} issues={issuesFor(issues, "question")}>
        <Textarea id="q" rows={2} value={value.question} onChange={(e) => set("question", e.target.value)} className="min-h-0 text-[15px] font-medium" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category" htmlFor="cat">
          <Select id="cat" value={value.category} onChange={(e) => set("category", e.target.value as CandidateEditInput["category"])}>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Market type">
          <div className="grid h-9 grid-cols-2 rounded-lg border border-line-strong bg-[#0a0c12] p-0.5 text-xs">
            {(["binary", "multiple"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() =>
                  onChange({
                    ...value,
                    outcomeType: t,
                    outcomes: t === "binary" ? [{ label: "Yes" }, { label: "No" }] : value.outcomes.length >= 2 ? value.outcomes : [{ label: "Option A" }, { label: "Option B" }, { label: "Other" }],
                  })
                }
                className={cn("rounded-md capitalize transition-colors", value.outcomeType === t ? "bg-panel-3 text-fg" : "text-muted hover:text-fg")}
              >
                {t === "binary" ? "Binary (Yes / No)" : "Multiple choice"}
              </button>
            ))}
          </div>
        </Field>
      </div>
      <Field label="Outcomes" issues={issuesFor(issues, "outcomes")} error={fieldErrors.outcomes}>
        <div className="space-y-2">
          {value.outcomes.map((o, i) => (
            <div key={i} className="flex gap-2">
              <Input
                value={o.label}
                aria-label={`Outcome ${i + 1}`}
                onChange={(e) => set("outcomes", value.outcomes.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
              />
              {value.outcomeType === "multiple" && (
                <Button type="button" variant="ghost" size="md" onClick={() => set("outcomes", value.outcomes.filter((_, j) => j !== i))} aria-label="Remove outcome">
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
          ))}
          {value.outcomeType === "multiple" && (
            <Button type="button" variant="outline" size="sm" icon={<Plus className="size-3.5" />} onClick={() => set("outcomes", [...value.outcomes, { label: "" }])}>
              Add outcome
            </Button>
          )}
        </div>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Event / resolution time (UTC)" htmlFor="ev" issues={issuesFor(issues, "eventDate")} error={fieldErrors.eventDate}>
          <Input id="ev" type="datetime-local" value={toLocalInput(value.eventDate)} onChange={(e) => set("eventDate", fromLocalInput(e.target.value))} />
        </Field>
        <Field label="Trading closes (UTC)" htmlFor="cl" issues={issuesFor(issues, "closeDate")} error={fieldErrors.closeDate}>
          <Input id="cl" type="datetime-local" value={toLocalInput(value.closeDate)} onChange={(e) => set("closeDate", fromLocalInput(e.target.value))} />
        </Field>
      </div>
      <Field label="Resolution criteria" htmlFor="rc" issues={issuesFor(issues, "resolutionCriteria")} hint="State exactly when it resolves YES/NO, the source, time zone, and what happens if postponed or cancelled.">
        <Textarea id="rc" rows={4} value={value.resolutionCriteria} onChange={(e) => set("resolutionCriteria", e.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Resolution source name" htmlFor="rsn">
          <Input id="rsn" value={value.resolutionSourceName} onChange={(e) => set("resolutionSourceName", e.target.value)} />
        </Field>
        <Field label="Resolution source URL" htmlFor="rsu" error={fieldErrors.resolutionSourceUrl} issues={issuesFor(issues, "resolutionSourceUrl")}>
          <Input id="rsu" value={value.resolutionSourceUrl} onChange={(e) => set("resolutionSourceUrl", e.target.value.trim())} placeholder="https://" />
        </Field>
      </div>
      <Field label="Description (context for traders)" htmlFor="desc" issues={issuesFor(issues, "description")}>
        <Textarea id="desc" rows={3} value={value.description} onChange={(e) => set("description", e.target.value)} />
      </Field>
      <Field label="Tags" htmlFor="tags" hint="Comma separated">
        <TagsInput value={value.tags} onChange={(tags) => set("tags", tags)} />
      </Field>
    </div>
  );
}

function TagsInput({ value, onChange }: { value: string[]; onChange: (tags: string[]) => void }) {
  const [raw, setRaw] = useState(value.join(", "));
  const commit = (text: string) =>
    onChange(
      text
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 10),
    );
  return (
    <Input
      id="tags"
      value={raw}
      onChange={(e) => {
        setRaw(e.target.value);
        commit(e.target.value);
      }}
      onBlur={() => setRaw(value.join(", "))}
    />
  );
}
