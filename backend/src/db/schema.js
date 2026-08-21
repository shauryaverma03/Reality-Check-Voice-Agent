// SQLite schema. Kept as plain CREATE TABLE statements (no ORM) so it's easy
// to read and easy to port to Postgres/Supabase later: swap `TEXT` primary
// keys for `uuid default gen_random_uuid()`, `datetime('now')` defaults for
// `now()`, and this file is ~90% of the migration.

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS checklists (
  id TEXT PRIMARY KEY,
  task_type TEXT NOT NULL UNIQUE,
  fields_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  task_type TEXT NOT NULL,
  unit_id TEXT,
  technician TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  raw_text TEXT,
  extracted_json TEXT NOT NULL,
  extraction_source TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  role TEXT NOT NULL,
  file_path TEXT,
  mime_type TEXT,
  extracted_json TEXT NOT NULL DEFAULT '{}',
  extraction_source TEXT NOT NULL DEFAULT 'none',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS verification_results (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  decision TEXT NOT NULL,
  evidence_score INTEGER NOT NULL,
  follow_up_question TEXT,
  fields_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  step TEXT NOT NULL,
  input_json TEXT,
  output_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_claims_task ON claims(task_id);
CREATE INDEX IF NOT EXISTS idx_evidence_task ON evidence(task_id);
CREATE INDEX IF NOT EXISTS idx_verification_task ON verification_results(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_task ON agent_runs(task_id);
`;
