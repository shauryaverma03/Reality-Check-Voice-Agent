import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SCHEMA_SQL } from './schema.js';
import { seedChecklists } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// DATA_DIR is overridable so a deploy can point it at a mounted persistent
// volume (SQLite + uploads both need a writable disk that survives
// redeploys — see README's Deployment section). Defaults to backend/data,
// unchanged from before this override existed.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'realitycheck.sqlite');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(SCHEMA_SQL);
seedChecklists(db); // idempotent — safe on every startup

// Additive columns on tables that predate them. CREATE TABLE IF NOT EXISTS in
// schema.js can't add a column to an already-existing table, so each of
// these runs once per pre-existing DB file and is a silent no-op (SQLite
// throws "duplicate column name") on every startup after that.
function addColumnIfMissing(sql) {
  try {
    db.exec(sql);
  } catch (err) {
    if (!/duplicate column name/i.test(err.message)) throw err;
  }
}

addColumnIfMissing('ALTER TABLE verification_results ADD COLUMN citations_json TEXT');
addColumnIfMissing('ALTER TABLE knowledge_documents ADD COLUMN manufacturer TEXT');
addColumnIfMissing('ALTER TABLE knowledge_documents ADD COLUMN model TEXT');
addColumnIfMissing("ALTER TABLE knowledge_documents ADD COLUMN source_type TEXT NOT NULL DEFAULT 'pdf'");
addColumnIfMissing('ALTER TABLE knowledge_documents ADD COLUMN source_url TEXT');
addColumnIfMissing('ALTER TABLE knowledge_chunks ADD COLUMN page INTEGER');
addColumnIfMissing('ALTER TABLE knowledge_chunks ADD COLUMN section TEXT');
// Image-quality signal (readable/issue/note) alongside each evidence item's
// already-existing extracted_json — see extraction/imageQuality.js.
addColumnIfMissing("ALTER TABLE evidence ADD COLUMN quality_json TEXT NOT NULL DEFAULT '{}'");
// Captured during the new multi-step job-creation flow (defect + machine
// model, alongside the pre-existing unit_id) — see routes/tasks.js.
addColumnIfMissing('ALTER TABLE tasks ADD COLUMN defect TEXT');
addColumnIfMissing('ALTER TABLE tasks ADD COLUMN machine_model TEXT');
// The compliance-vs-function split (see checklists.js): whether anything in
// the evidence actually shows the unit WORKS post-repair, kept separate from
// whether the checklist was satisfied.
addColumnIfMissing('ALTER TABLE verification_results ADD COLUMN functional_json TEXT');
addColumnIfMissing('ALTER TABLE verification_results ADD COLUMN verification_scope TEXT');
// Observability: per-step latency, model, prompt version, token usage and
// cost. Columns rather than a JSON blob so they can be aggregated in SQL
// (SUM/AVG/percentiles) without parsing every row — see routes/observability.js.
addColumnIfMissing('ALTER TABLE agent_runs ADD COLUMN duration_ms INTEGER');
addColumnIfMissing('ALTER TABLE agent_runs ADD COLUMN mode TEXT');
addColumnIfMissing('ALTER TABLE agent_runs ADD COLUMN model TEXT');
addColumnIfMissing('ALTER TABLE agent_runs ADD COLUMN prompt_key TEXT');
addColumnIfMissing('ALTER TABLE agent_runs ADD COLUMN prompt_version TEXT');
addColumnIfMissing('ALTER TABLE agent_runs ADD COLUMN prompt_hash TEXT');
addColumnIfMissing('ALTER TABLE agent_runs ADD COLUMN input_tokens INTEGER');
addColumnIfMissing('ALTER TABLE agent_runs ADD COLUMN output_tokens INTEGER');
addColumnIfMissing('ALTER TABLE agent_runs ADD COLUMN cost_usd REAL');
addColumnIfMissing('ALTER TABLE agent_runs ADD COLUMN rate_tier TEXT');
addColumnIfMissing('ALTER TABLE agent_runs ADD COLUMN fallback_reason TEXT');

export function getChecklistForTaskType(taskType) {
  const row = db.prepare('SELECT fields_json FROM checklists WHERE task_type = ?').get(taskType);
  if (!row) {
    throw new Error(`No checklist found for task_type "${taskType}".`);
  }
  return JSON.parse(row.fields_json);
}
