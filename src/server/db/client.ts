/**
 * Database adapter. Production uses PostgreSQL through `pg` (e.g. Neon on Vercel) when
 * DATABASE_URL is set. Without it we boot PGlite — real Postgres compiled to WASM — so the exact
 * same SQL runs locally, in tests and in zero-config demo deployments.
 */
import { config } from "../config";
import { logger } from "../logger";
import { runMigrations } from "./schema";
import { seedDatabase } from "./seed";

export interface QueryResult<T> {
  rows: T[];
}

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
}

export interface Db extends Queryable {
  kind: "postgres" | "pglite";
  exec(sql: string): Promise<void>;
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

async function createPostgres(url: string): Promise<Db> {
  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString: url,
    max: 5,
    idleTimeoutMillis: 10_000,
    ssl: /sslmode=disable|localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false },
  });
  pool.on("error", (err) => logger.error("db.pool_error", { err }));
  return {
    kind: "postgres",
    async query<T>(sql: string, params: unknown[] = []) {
      const res = await pool.query(sql, params);
      return { rows: res.rows as T[] };
    },
    async exec(sql: string) {
      await pool.query(sql);
    },
    async tx<T>(fn: (q: Queryable) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn({
          async query<R>(sql: string, params: unknown[] = []) {
            const res = await client.query(sql, params);
            return { rows: res.rows as R[] };
          },
        });
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

export async function createPglite(dataDir: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  if (dataDir !== "memory") {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(dataDir, { recursive: true });
  }
  const pg = await PGlite.create(dataDir === "memory" ? undefined : dataDir);
  return {
    kind: "pglite",
    async query<T>(sql: string, params: unknown[] = []) {
      const res = await pg.query<T>(sql, params);
      return { rows: res.rows };
    },
    async exec(sql: string) {
      await pg.exec(sql);
    },
    async tx<T>(fn: (q: Queryable) => Promise<T>) {
      return pg.transaction(async (t) =>
        fn({
          async query<R>(sql: string, params: unknown[] = []) {
            const res = await t.query<R>(sql, params);
            return { rows: res.rows };
          },
        }),
      );
    },
    close: () => pg.close(),
  };
}

export async function initDb(db: Db, opts: { seed?: boolean } = {}): Promise<Db> {
  await runMigrations(db);
  if (opts.seed !== false) await seedDatabase(db);
  return db;
}

const globalForDb = globalThis as unknown as { __omxDb?: Promise<Db> };

/** Process-wide database handle (survives Next.js dev hot reloads). */
export function getDb(): Promise<Db> {
  if (!globalForDb.__omxDb) {
    const started = Date.now();
    globalForDb.__omxDb = (async () => {
      const db = config.databaseUrl ? await createPostgres(config.databaseUrl) : await createPglite(config.pgliteDir);
      await initDb(db);
      logger.info("db.ready", { kind: db.kind, ms: Date.now() - started, dir: db.kind === "pglite" ? config.pgliteDir : undefined });
      return db;
    })().catch((err) => {
      globalForDb.__omxDb = undefined;
      logger.error("db.init_failed", { err });
      throw err;
    });
  }
  return globalForDb.__omxDb;
}

/** Test hook: replace the process-wide database. */
export function setDbForTests(db: Db | undefined) {
  globalForDb.__omxDb = db ? Promise.resolve(db) : undefined;
}
