"use client";

import { BookOpen, Cpu, Inbox, LayoutDashboard, LogOut, Menu, Radar, Rss, Store, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import useSWR from "swr";
import { Logo } from "@/components/logo";
import type { MeResponse, OverviewResponse } from "@/lib/api-types";
import { apiFetch, fetcher } from "@/lib/client";
import { cn } from "@/lib/format";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/discovery", label: "Discovery", icon: Radar },
  { href: "/candidates", label: "Review queue", icon: Inbox, countKey: "pending" as const },
  { href: "/markets", label: "Markets", icon: Store },
  { href: "/sources", label: "Sources", icon: Rss },
  { href: "/guide", label: "How it works", icon: BookOpen },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { data } = useSWR<OverviewResponse>("/api/overview", fetcher, { refreshInterval: 30_000 });
  const pending = data?.candidates.pending_review ?? 0;
  return (
    <nav className="space-y-0.5">
      {NAV.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
              active ? "bg-panel-3 text-fg" : "text-muted hover:bg-panel-2 hover:text-fg",
            )}
          >
            {active && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-accent" />}
            <Icon className={cn("size-4", active ? "text-accent" : "text-faint group-hover:text-muted")} />
            <span className="flex-1">{item.label}</span>
            {item.countKey && pending > 0 && (
              <span className="rounded-md bg-warn/15 px-1.5 py-px font-mono text-[10px] font-semibold tabular-nums text-warn">{pending}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarFooter() {
  const router = useRouter();
  const { data: me } = useSWR<MeResponse>("/api/auth/me", fetcher);
  const { data } = useSWR<OverviewResponse>("/api/overview", fetcher, { refreshInterval: 30_000 });
  const sys = data?.system;
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-line bg-panel-2/70 p-3">
        <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-faint">
          <Cpu className="size-3" /> Analyzer
        </div>
        {sys ? (
          <div className="space-y-1 text-xs">
            <div className="flex items-center gap-2">
              <span className={cn("size-1.5 animate-pulse-dot rounded-full", sys.analyzer === "groq" ? "bg-ok" : "bg-warn")} />
              <span className="font-medium">{sys.analyzer === "groq" ? "Groq LLM" : "Heuristic fallback"}</span>
            </div>
            <div className="truncate font-mono text-[10px] text-faint">{sys.model ?? "no GROQ_API_KEY set"}</div>
            <div className="font-mono text-[10px] text-faint">db: {sys.database}</div>
          </div>
        ) : (
          <div className="skeleton h-8" />
        )}
      </div>
      <div className="flex items-center gap-2.5 px-1">
        <div className="grid size-8 place-items-center rounded-full bg-gradient-to-br from-panel-3 to-line-strong text-xs font-semibold text-fg">
          {(me?.user?.name ?? "?").slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{me?.user?.name ?? "—"}</div>
          <div className="text-[11px] text-faint">Reviewer</div>
        </div>
        <button
          title="Sign out"
          aria-label="Sign out"
          onClick={async () => {
            await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
            router.replace("/login");
            router.refresh();
          }}
          className="rounded-md p-1.5 text-faint transition-colors hover:bg-panel-3 hover:text-fg"
        >
          <LogOut className="size-4" />
        </button>
      </div>
    </div>
  );
}

export function ConsoleShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col justify-between border-r border-line bg-panel/60 px-3 py-4 backdrop-blur lg:flex">
        <div>
          <div className="mb-6 px-2">
            <Logo />
          </div>
          <NavLinks />
        </div>
        <SidebarFooter />
      </aside>

      {/* Mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-line bg-panel/90 px-4 backdrop-blur lg:hidden">
        <Logo />
        <button onClick={() => setOpen(true)} className="rounded-md p-2 text-muted hover:bg-panel-3" aria-label="Open menu">
          <Menu className="size-5" />
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 animate-slide-up flex-col justify-between border-r border-line bg-panel px-3 py-4">
            <div>
              <div className="mb-6 flex items-center justify-between px-2">
                <Logo />
                <button onClick={() => setOpen(false)} className="rounded-md p-1.5 text-muted hover:bg-panel-3" aria-label="Close menu">
                  <X className="size-4" />
                </button>
              </div>
              <NavLinks onNavigate={() => setOpen(false)} />
            </div>
            <SidebarFooter />
          </aside>
        </div>
      )}

      <main className="min-w-0 flex-1 px-4 pb-16 pt-20 sm:px-6 lg:px-10 lg:pt-8">
        <div className="mx-auto max-w-[1280px]">{children}</div>
      </main>
    </div>
  );
}
