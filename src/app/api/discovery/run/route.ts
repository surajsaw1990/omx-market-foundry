/**
 * POST /api/discovery/run — starts a discovery run and streams progress as NDJSON
 * (one JSON event per line). Errors that happen before the run starts (cooldown, run already in
 * progress) are returned as regular JSON errors with the proper status code.
 */
import { runDiscovery, type DiscoveryEvent } from "@/server/discovery/pipeline";
import { api } from "@/server/http/handler";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = api(async ({ db, actor }) => {
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  let closed = false;
  const write = (obj: unknown) => {
    if (closed) return;
    writer.write(encoder.encode(`${JSON.stringify(obj)}\n`)).catch(() => {
      closed = true;
    });
  };

  let resolveStarted!: () => void;
  const started = new Promise<void>((resolve) => (resolveStarted = resolve));
  const run = runDiscovery({
    db,
    trigger: "manual",
    actor,
    budgetMs: 45_000,
    emit: (e: DiscoveryEvent) => {
      resolveStarted();
      write(e);
    },
  });

  // Surface pre-start errors (cooldown / already running) as normal HTTP errors.
  await Promise.race([started, run]);

  run
    .catch((err: Error) => write({ type: "log", level: "error", message: err.message }))
    .finally(() => {
      closed = true;
      writer.close().catch(() => undefined);
    });

  return new Response(readable, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
});
