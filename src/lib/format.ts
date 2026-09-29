import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
  ["second", 1],
];

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const diff = (Date.parse(iso) - now) / 1000;
  for (const [unit, sec] of UNITS) {
    if (Math.abs(diff) >= sec || unit === "second") {
      const v = Math.round(diff / sec);
      if (unit === "second" && Math.abs(v) < 30) return "just now";
      return rtf.format(v, unit);
    }
  }
  return "—";
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "Not set";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** ISO → value for <input type="datetime-local"> (interpreted as UTC in this app). */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toISOString().slice(0, 16);
}

export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const t = Date.parse(`${v}:00Z`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function scoreTone(score: number): "ok" | "warn" | "bad" {
  if (score >= 75) return "ok";
  if (score >= 50) return "warn";
  return "bad";
}

export function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
