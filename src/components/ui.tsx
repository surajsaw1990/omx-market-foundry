"use client";

import { AlertOctagon, AlertTriangle, Info, Loader2, X } from "lucide-react";
import { forwardRef, useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { STATUS_LABELS, type CandidateStatus, type Severity } from "@/lib/domain";
import { cn, scoreTone } from "@/lib/format";

/* --------------------------------- Button --------------------------------- */

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success" | "outline";
const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-white shadow-[0_0_0_1px_#ffffff14_inset,0_8px_24px_-8px_#8b6cff99] hover:bg-accent-strong disabled:bg-accent/40",
  secondary: "bg-panel-3 text-fg border border-line-strong hover:bg-[#222739] hover:border-[#3a4158]",
  outline: "bg-transparent text-fg border border-line-strong hover:bg-panel-2",
  ghost: "bg-transparent text-muted hover:text-fg hover:bg-panel-2",
  danger: "bg-bad/10 text-bad border border-bad/30 hover:bg-bad/20",
  success: "bg-ok text-[#04130c] font-semibold shadow-[0_8px_24px_-10px_#3ddc97aa] hover:bg-[#5ce6aa] disabled:bg-ok/40",
};
const SIZES = { sm: "h-8 px-3 text-xs gap-1.5", md: "h-9 px-3.5 text-sm gap-2", lg: "h-11 px-5 text-sm gap-2" };

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: keyof typeof SIZES;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center rounded-lg font-medium transition-all duration-150 select-none whitespace-nowrap",
        "disabled:cursor-not-allowed disabled:opacity-60 active:scale-[0.98]",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

/* ---------------------------------- Badge --------------------------------- */

export type Tone = "neutral" | "accent" | "ok" | "warn" | "bad" | "info" | "cyan";
const TONES: Record<Tone, string> = {
  neutral: "bg-panel-3 text-muted border-line-strong",
  accent: "bg-accent/12 text-[#b7a5ff] border-accent/30",
  ok: "bg-ok/10 text-ok border-ok/25",
  warn: "bg-warn/10 text-warn border-warn/25",
  bad: "bg-bad/10 text-bad border-bad/25",
  info: "bg-info/10 text-info border-info/25",
  cyan: "bg-cyan/10 text-cyan border-cyan/25",
};

export function Badge({ tone = "neutral", children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-4", TONES[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

const STATUS_TONE: Record<CandidateStatus, Tone> = {
  pending_review: "warn",
  approved: "ok",
  rejected: "bad",
  market_created: "accent",
};

export function StatusBadge({ status, className }: { status: CandidateStatus; className?: string }) {
  return (
    <Badge tone={STATUS_TONE[status]} dot className={className}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

/* ---------------------------------- Card ---------------------------------- */

export function Card({ children, className, ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("panel", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, description, icon, actions, className }: { title: ReactNode; description?: ReactNode; icon?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start justify-between gap-3 px-5 pt-4 pb-3", className)}>
      <div className="flex min-w-0 items-start gap-2.5">
        {icon && <div className="mt-0.5 text-muted">{icon}</div>}
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight text-fg">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ---------------------------------- Forms --------------------------------- */

const fieldBase =
  "w-full rounded-lg border border-line-strong bg-[#0a0c12] px-3 text-sm text-fg placeholder:text-faint transition-colors focus:border-accent/70 focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-60";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(fieldBase, "h-9", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(fieldBase, "min-h-[84px] py-2 leading-relaxed", className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cn(fieldBase, "h-9 appearance-none bg-[length:12px] bg-[right_10px_center] bg-no-repeat pr-8", className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238f97ab' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }} {...rest}>
      {children}
    </select>
  );
});

export function Field({ label, hint, error, children, className, htmlFor, issues }: { label: ReactNode; hint?: ReactNode; error?: string; children: ReactNode; className?: string; htmlFor?: string; issues?: { severity: Severity; message: string }[] }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-xs font-medium text-muted">
        {label}
      </label>
      {children}
      {error ? <p className="text-xs text-bad">{error}</p> : hint ? <p className="text-xs text-faint">{hint}</p> : null}
      {issues?.map((i, idx) => (
        <p key={idx} className={cn("flex items-start gap-1.5 text-xs", i.severity === "blocker" ? "text-bad" : i.severity === "warning" ? "text-warn" : "text-info")}>
          <SeverityIcon severity={i.severity} className="mt-px size-3.5 shrink-0" />
          {i.message}
        </p>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors disabled:opacity-50",
        checked ? "border-accent/60 bg-accent" : "border-line-strong bg-panel-3",
      )}
    >
      <span className={cn("inline-block size-3.5 rounded-full bg-white shadow transition-transform", checked ? "translate-x-[18px]" : "translate-x-[3px]")} />
    </button>
  );
}

/* ---------------------------------- Modal --------------------------------- */

export function Modal({ open, onClose, title, description, children, footer, size = "md" }: { open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode; size?: "md" | "lg" | "xl" }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("textarea, input, button")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 animate-fade-in bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        className={cn("panel relative w-full animate-slide-up shadow-2xl shadow-black/60", size === "md" ? "max-w-lg" : size === "lg" ? "max-w-2xl" : "max-w-4xl")}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-base font-semibold tracking-tight">{title}</h2>
            {description && <p className="mt-1 text-sm text-muted">{description}</p>}
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-panel-3 hover:text-fg" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        {children && <div className="scrollbar-thin max-h-[65vh] overflow-y-auto px-5 py-4">{children}</div>}
        {footer && <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</div>}
      </div>
    </div>
  );
}

/* --------------------------------- Display -------------------------------- */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton h-4", className)} />;
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-3 rounded-xl border border-line bg-panel-2 p-3 text-muted">{icon}</div>}
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function SeverityIcon({ severity, className }: { severity: Severity; className?: string }) {
  if (severity === "blocker") return <AlertOctagon className={cn("text-bad", className)} />;
  if (severity === "warning") return <AlertTriangle className={cn("text-warn", className)} />;
  return <Info className={cn("text-info", className)} />;
}

const RING = { ok: "#3ddc97", warn: "#f5b93d", bad: "#ff6b81" };

export function ScoreRing({ score, size = 44, stroke = 4, label = true }: { score: number; size?: number; stroke?: number; label?: boolean }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = RING[scoreTone(score)];
  return (
    <div className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }} title={`Quality score ${score}/100`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#1f2433" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - score / 100)}
          style={{ transition: "stroke-dashoffset 0.6s ease", filter: `drop-shadow(0 0 4px ${color}66)` }}
        />
      </svg>
      {label && (
        <span className="absolute font-mono font-semibold tabular-nums" style={{ fontSize: size * 0.3, color }}>
          {score}
        </span>
      )}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode; count?: number }[] }) {
  return (
    <div className="scrollbar-thin inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border border-line bg-panel p-1">
      {items.map((it) => (
        <button
          key={it.value}
          onClick={() => onChange(it.value)}
          className={cn(
            "inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
            value === it.value ? "bg-panel-3 text-fg shadow-[0_0_0_1px_#2b3143]" : "text-muted hover:text-fg",
          )}
        >
          {it.label}
          {it.count !== undefined && (
            <span className={cn("rounded-md px-1.5 py-px font-mono text-[10px] tabular-nums", value === it.value ? "bg-accent/20 text-[#c4b5ff]" : "bg-panel-3 text-faint")}>
              {it.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line-strong bg-panel-3 px-1.5 py-px font-mono text-[10px] text-muted">{children}</kbd>;
}

export function PageHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5 text-xs font-medium text-accent">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
