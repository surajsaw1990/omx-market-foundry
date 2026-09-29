/**
 * Versioned SQL migrations. Applied in order inside a transaction guarded by an advisory lock,
 * so concurrent serverless cold starts cannot race each other.
 * See docs/DATA_MODEL.md for an explanation of each table.
 */
import type { Db } from "./client";

export const MIGRATIONS: { id: number; name: string; sql: string }[] = [
  {
    id: 1,
    name: "initial_schema",
    sql: `
CREATE TABLE sources (
  id                   TEXT PRIMARY KEY,
  slug                 TEXT NOT NULL UNIQUE,
  name                 TEXT NOT NULL,
  type                 TEXT NOT NULL CHECK (type IN ('rss','fixture')),
  url                  TEXT NOT NULL,
  category_hint        TEXT,
  reliability          TEXT NOT NULL,
  enabled              BOOLEAN NOT NULL DEFAULT TRUE,
  last_fetched_at      TIMESTAMPTZ,
  last_status          TEXT,
  last_error           TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE discovery_runs (
  id           TEXT PRIMARY KEY,
  trigger      TEXT NOT NULL,
  triggered_by TEXT NOT NULL,
  status       TEXT NOT NULL,
  analyzer     TEXT NOT NULL,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ,
  stats        JSONB NOT NULL DEFAULT '{}'::jsonb,
  log          JSONB NOT NULL DEFAULT '[]'::jsonb,
  error        TEXT
);
CREATE INDEX discovery_runs_started_idx ON discovery_runs (started_at DESC);
-- At most one discovery run may be in progress: a second concurrent insert fails with a unique violation.
CREATE UNIQUE INDEX discovery_runs_one_running ON discovery_runs ((status)) WHERE status = 'running';

CREATE TABLE source_items (
  id              TEXT PRIMARY KEY,
  source_id       TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  run_id          TEXT REFERENCES discovery_runs(id) ON DELETE SET NULL,
  external_id     TEXT,
  url             TEXT NOT NULL,
  url_hash        TEXT NOT NULL UNIQUE,
  content_hash    TEXT NOT NULL,
  title           TEXT NOT NULL,
  summary         TEXT NOT NULL DEFAULT '',
  published_at    TIMESTAMPTZ,
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw             JSONB NOT NULL DEFAULT '{}'::jsonb,
  status          TEXT NOT NULL DEFAULT 'new',
  prefilter_score REAL NOT NULL DEFAULT 0,
  reason          TEXT,
  analysis        JSONB,
  candidate_id    TEXT
);
CREATE INDEX source_items_run_idx ON source_items (run_id);
CREATE INDEX source_items_status_idx ON source_items (status, fetched_at DESC);

CREATE TABLE candidates (
  id                     TEXT PRIMARY KEY,
  question               TEXT NOT NULL,
  category               TEXT NOT NULL,
  description            TEXT NOT NULL DEFAULT '',
  outcome_type           TEXT NOT NULL CHECK (outcome_type IN ('binary','multiple')),
  outcomes               JSONB NOT NULL,
  event_date             TIMESTAMPTZ,
  close_date             TIMESTAMPTZ,
  resolution_criteria    TEXT NOT NULL DEFAULT '',
  resolution_source_name TEXT NOT NULL DEFAULT '',
  resolution_source_url  TEXT NOT NULL DEFAULT '',
  tags                   JSONB NOT NULL DEFAULT '[]'::jsonb,
  event_key              TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'pending_review'
                         CHECK (status IN ('pending_review','approved','rejected','market_created')),
  confidence             REAL,
  ai_rationale           TEXT NOT NULL DEFAULT '',
  ambiguity_notes        JSONB NOT NULL DEFAULT '[]'::jsonb,
  generator              TEXT NOT NULL,
  validation             JSONB NOT NULL,
  quality_score          INTEGER NOT NULL DEFAULT 0,
  version                INTEGER NOT NULL DEFAULT 1,
  review_note            TEXT,
  reviewed_by            TEXT,
  reviewed_at            TIMESTAMPTZ,
  run_id                 TEXT REFERENCES discovery_runs(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX candidates_status_idx ON candidates (status, quality_score DESC);
CREATE INDEX candidates_event_key_idx ON candidates (event_key);

CREATE TABLE candidate_sources (
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  item_id      TEXT NOT NULL REFERENCES source_items(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('primary','supporting','conflicting')),
  facts        JSONB NOT NULL DEFAULT '{}'::jsonb,
  added_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (candidate_id, item_id)
);

CREATE TABLE candidate_revisions (
  id           TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  version      INTEGER NOT NULL,
  changed_by   TEXT NOT NULL,
  changes      JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (candidate_id, version)
);

CREATE TABLE markets (
  id           TEXT PRIMARY KEY,
  candidate_id TEXT UNIQUE REFERENCES candidates(id) ON DELETE SET NULL,
  external_id  TEXT NOT NULL UNIQUE,
  external_url TEXT NOT NULL,
  slug         TEXT NOT NULL,
  question     TEXT NOT NULL,
  category     TEXT NOT NULL,
  status       TEXT NOT NULL,
  payload      JSONB NOT NULL,
  event_date   TIMESTAMPTZ,
  is_seed      BOOLEAN NOT NULL DEFAULT FALSE,
  created_by   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Stand-in for the external OmniMarketX market service (mock API storage).
CREATE TABLE omx_markets (
  id              TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  payload         JSONB NOT NULL,
  status          TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_events (
  id          TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  action      TEXT NOT NULL,
  actor       TEXT NOT NULL,
  details     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_entity_idx ON audit_events (entity_type, entity_id, created_at);
`,
  },
];

export async function runMigrations(db: Db): Promise<void> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await db.tx(async (q) => {
    await q.query("SELECT pg_advisory_xact_lock(727274)");
    const { rows } = await q.query<{ id: number }>("SELECT id FROM schema_migrations");
    const applied = new Set(rows.map((r) => Number(r.id)));
    for (const m of MIGRATIONS) {
      if (applied.has(m.id)) continue;
      for (const statement of m.sql.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) {
        await q.query(statement);
      }
      await q.query("INSERT INTO schema_migrations (id, name) VALUES ($1, $2)", [m.id, m.name]);
    }
  });
}
