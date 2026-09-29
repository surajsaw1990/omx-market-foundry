/**
 * Minimal structured logger: one JSON object per line on stdout/stderr, which Vercel's
 * log drains (and most log platforms) index without extra configuration.
 */
type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel = LEVELS[(process.env.LOG_LEVEL as Level) || "info"] ?? 20;

function serializeError(err: unknown) {
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack?.split("\n").slice(0, 4).join("\n") };
  return err;
}

function write(level: Level, event: string, fields?: Fields) {
  if (LEVELS[level] < minLevel || process.env.VITEST) return;
  const entry: Fields = { ts: new Date().toISOString(), level, event, ...fields };
  if (entry.err) entry.err = serializeError(entry.err);
  const line = JSON.stringify(entry);
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const logger = {
  debug: (event: string, fields?: Fields) => write("debug", event, fields),
  info: (event: string, fields?: Fields) => write("info", event, fields),
  warn: (event: string, fields?: Fields) => write("warn", event, fields),
  error: (event: string, fields?: Fields) => write("error", event, fields),
};
