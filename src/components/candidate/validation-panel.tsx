"use client";

import { ShieldCheck } from "lucide-react";
import type { ValidationReport } from "@/lib/domain";
import { cn } from "@/lib/format";
import { Card, ScoreRing, SeverityIcon } from "../ui";

const FIELD_LABEL: Record<string, string> = {
  question: "Question",
  outcomes: "Outcomes",
  closeDate: "Close date",
  eventDate: "Event date",
  resolutionCriteria: "Resolution criteria",
  resolutionSourceUrl: "Resolution source",
  description: "Description",
};

export function ValidationPanel({ report, live = false }: { report: ValidationReport; live?: boolean }) {
  const groups = (["blocker", "warning", "info"] as const).map((sev) => ({ sev, issues: report.issues.filter((i) => i.severity === sev) }));
  return (
    <Card data-testid="validation-panel">
      <div className="flex items-center gap-4 border-b border-line px-5 py-4">
        <ScoreRing score={report.score} size={58} stroke={5} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-semibold">
            Quality checks {live && <span className="rounded bg-accent/15 px-1.5 py-px text-[10px] font-medium text-[#c4b5ff]">live preview</span>}
          </div>
          <div className="mt-1 flex flex-wrap gap-3 text-xs">
            <span className={cn(report.blockers ? "text-bad" : "text-faint")}>{report.blockers} blocking</span>
            <span className={cn(report.warnings ? "text-warn" : "text-faint")}>{report.warnings} warnings</span>
            <span className="text-faint">{report.issues.length - report.blockers - report.warnings} notes</span>
          </div>
        </div>
      </div>
      <div className="space-y-4 px-5 py-4">
        {report.issues.length === 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-ok/25 bg-ok/5 px-3 py-2.5 text-sm text-ok">
            <ShieldCheck className="size-4" /> All checks passed.
          </div>
        )}
        {groups.map(
          ({ sev, issues }) =>
            issues.length > 0 && (
              <div key={sev}>
                <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-faint">
                  {sev === "blocker" ? "Must fix before approval" : sev === "warning" ? "Review carefully" : "Notes"}
                </div>
                <ul className="space-y-2">
                  {issues.map((i, idx) => (
                    <li
                      key={`${i.code}-${idx}`}
                      className={cn(
                        "rounded-lg border px-3 py-2.5",
                        sev === "blocker" ? "border-bad/25 bg-bad/5" : sev === "warning" ? "border-warn/20 bg-warn/[0.04]" : "border-line bg-panel-2/50",
                      )}
                      data-code={i.code}
                    >
                      <div className="flex items-start gap-2">
                        <SeverityIcon severity={i.severity} className="mt-0.5 size-4 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-[13px] leading-snug text-fg/95">{i.message}</p>
                          {i.hint && <p className="mt-1 text-xs text-muted">{i.hint}</p>}
                          <div className="mt-1.5 flex flex-wrap gap-2 font-mono text-[10px] text-faint">
                            <span>{i.code}</span>
                            {i.field && <span>· {FIELD_LABEL[i.field] ?? i.field}</span>}
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ),
        )}
      </div>
    </Card>
  );
}
