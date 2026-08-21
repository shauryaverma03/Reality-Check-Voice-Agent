import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SCHEMA_SQL } from './schema.js';
import { seedChecklists } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data'); // backend/data
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'realitycheck.sqlite');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(SCHEMA_SQL);
seedChecklists(db); // idempotent — safe on every startup

export function getChecklistForTaskType(taskType) {
  const row = db.prepare('SELECT fields_json FROM checklists WHERE task_type = ?').get(taskType);
  if (!row) {
    throw new Error(`No checklist found for task_type "${taskType}".`);
  }
  return JSON.parse(row.fields_json);
}
