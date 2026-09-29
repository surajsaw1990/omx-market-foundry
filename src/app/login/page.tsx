"use client";

import { ArrowRight, KeyRound, ShieldCheck, Sparkles } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Field, Input } from "@/components/ui";
import { Logo } from "@/components/logo";
import { apiFetch, ApiError } from "@/lib/client";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [demoCode, setDemoCode] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ demoAccessCode: string | null }>("/api/auth/me")
      .then((r) => setDemoCode(r.demoAccessCode))
      .catch(() => undefined);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiFetch("/api/auth/login", { body: { name, code } });
      const next = params.get("next");
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? (err.code === "VALIDATION_FAILED" ? "Enter your name (2+ characters) and the access code." : err.message) : "Could not sign in.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Your name" hint="Recorded on every review decision in the audit log." htmlFor="name">
        <Input id="name" autoComplete="name" placeholder="e.g. Priya Sharma" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
      <Field label="Reviewer access code" htmlFor="code" error={error ?? undefined}>
        <Input id="code" type="password" autoComplete="current-password" placeholder="••••••••" value={code} onChange={(e) => setCode(e.target.value)} />
      </Field>
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading} icon={!loading && <ArrowRight className="size-4" />}>
        Sign in to the console
      </Button>
      {demoCode && (
        <button
          type="button"
          onClick={() => {
            setCode(demoCode);
            if (!name) setName("Demo Reviewer");
          }}
          className="flex w-full items-center justify-between rounded-lg border border-dashed border-accent/40 bg-accent/5 px-3 py-2.5 text-left text-xs text-muted transition-colors hover:bg-accent/10"
        >
          <span className="flex items-center gap-2">
            <KeyRound className="size-3.5 text-accent" />
            Demo access code: <code className="font-mono text-fg">{demoCode}</code>
          </span>
          <span className="text-accent">Use it →</span>
        </button>
      )}
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden border-r border-line lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(700px_400px_at_20%_20%,#8b6cff22,transparent_70%),radial-gradient(600px_400px_at_80%_90%,#33d6f014,transparent_70%)]" />
        <Logo />
        <div className="relative max-w-lg">
          <h1 className="text-4xl font-semibold leading-tight tracking-tight">
            From public signals to <span className="bg-gradient-to-r from-[#b7a5ff] to-cyan bg-clip-text text-transparent">reviewable markets</span>.
          </h1>
          <p className="mt-4 text-muted">
            Market Foundry scans configured public sources, drafts structured prediction-market candidates, flags ambiguity, duplicates and
            weak resolution sources — and keeps a human in charge of every market that goes live.
          </p>
          <div className="mt-8 flex flex-wrap gap-2 text-xs">
            {["Discover", "Analyze", "Structure", "Validate", "Review", "Create"].map((s, i) => (
              <span key={s} className="inline-flex items-center gap-2 rounded-full border border-line-strong bg-panel/70 px-3 py-1.5 text-muted">
                <span className="font-mono text-[10px] text-accent">{String(i + 1).padStart(2, "0")}</span>
                {s}
              </span>
            ))}
          </div>
        </div>
        <p className="relative flex items-center gap-2 text-xs text-faint">
          <ShieldCheck className="size-3.5" /> Automated discovery never publishes. Approval and creation are human actions.
        </p>
      </section>
      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          <div className="mb-6">
            <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-[#c4b5ff]">
              <Sparkles className="size-3" /> Internal tool
            </div>
            <h2 className="text-2xl font-semibold tracking-tight">Reviewer sign in</h2>
            <p className="mt-1 text-sm text-muted">Only authorised reviewers can approve candidates and create markets.</p>
          </div>
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
      </section>
    </main>
  );
}
