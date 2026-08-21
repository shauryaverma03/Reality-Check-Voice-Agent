import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import multer from 'multer';
import { db, getChecklistForTaskType } from '../db/index.js';
import { verifyTask } from '../verifier.js';
import { extractClaimFromVoice, extractEvidenceFromPhoto } from '../extraction/extract.js';

const router = Router();

const DATA_DIR = path.join(process.cwd(), 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 8 * 1024 * 1024 } });

const STATUS_BY_DECISION = {
  VERIFIED: 'verified',
  NEED_MORE_EVIDENCE: 'need_more_evidence',
  CONFLICT_HUMAN_REVIEW: 'conflict',
};

function logAgentRun(taskId, step, input, output) {
  db.prepare(
    `INSERT INTO agent_runs (id, task_id, step, input_json, output_json) VALUES (?, ?, ?, ?, ?)`
  ).run(randomUUID(), taskId, step, JSON.stringify(input ?? null), JSON.stringify(output ?? null));
}

function getTaskOr404(req, res) {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) {
    res.status(404).json({ error: 'task not found' });
    return null;
  }
  return task;
}

function serializeEvidence(row) {
  return { ...row, extracted: JSON.parse(row.extracted_json) };
}

function serializeClaim(row) {
  return row ? { ...row, extracted: JSON.parse(row.extracted_json) } : null;
}

function serializeVerification(row) {
  return row ? { ...row, fields: JSON.parse(row.fields_json) } : null;
}

// -----------------------------------------------------------------------
// POST /tasks
// -----------------------------------------------------------------------
router.post('/tasks', (req, res) => {
  const { task_type = 'ac-service', unit_id = null, technician = null } = req.body || {};
  try {
    getChecklistForTaskType(task_type);
  } catch {
    return res.status(400).json({ error: `unknown task_type "${task_type}"` });
  }

  const id = randomUUID();
  db.prepare(
    `INSERT INTO tasks (id, task_type, unit_id, technician, status) VALUES (?, ?, ?, ?, 'pending')`
  ).run(id, task_type, unit_id, technician);
  logAgentRun(id, 'create_task', { task_type, unit_id, technician }, null);

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  res.status(201).json(task);
});

// -----------------------------------------------------------------------
// GET /tasks  — list, with latest verification joined in for the dashboard
// -----------------------------------------------------------------------
router.get('/tasks', (req, res) => {
  const tasks = db
    .prepare(
      `SELECT t.*,
        vr.decision AS latest_decision,
        vr.evidence_score AS latest_score,
        vr.created_at AS verified_at
      FROM tasks t
      LEFT JOIN verification_results vr ON vr.id = (
        SELECT id FROM verification_results WHERE task_id = t.id ORDER BY created_at DESC LIMIT 1
      )
      ORDER BY t.created_at DESC`
    )
    .all();
  res.json(tasks);
});

// -----------------------------------------------------------------------
// GET /tasks/:id
// -----------------------------------------------------------------------
router.get('/tasks/:id', (req, res) => {
  const task = getTaskOr404(req, res);
  if (!task) return;

  const claim = db.prepare('SELECT * FROM claims WHERE task_id = ? ORDER BY created_at DESC LIMIT 1').get(task.id);
  const evidence = db.prepare('SELECT * FROM evidence WHERE task_id = ? ORDER BY created_at ASC').all(task.id);
  const verification = db
    .prepare('SELECT * FROM verification_results WHERE task_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(task.id);

  res.json({
    task,
    claim: serializeClaim(claim),
    evidence: evidence.map(serializeEvidence),
    verification: serializeVerification(verification),
  });
});

// -----------------------------------------------------------------------
// POST /tasks/:id/claim   { raw_text }
// -----------------------------------------------------------------------
router.post('/tasks/:id/claim', async (req, res) => {
  const task = getTaskOr404(req, res);
  if (!task) return;

  const { raw_text } = req.body || {};
  if (!raw_text || !raw_text.trim()) {
    return res.status(400).json({ error: 'raw_text is required' });
  }

  const { data, source } = await extractClaimFromVoice({ rawText: raw_text });

  const id = randomUUID();
  db.prepare(
    `INSERT INTO claims (id, task_id, raw_text, extracted_json, extraction_source) VALUES (?, ?, ?, ?, ?)`
  ).run(id, task.id, raw_text, JSON.stringify(data), source);
  logAgentRun(task.id, 'extract_claim', { raw_text }, { data, source });

  const claim = db.prepare('SELECT * FROM claims WHERE id = ?').get(id);
  res.status(201).json(serializeClaim(claim));
});

// -----------------------------------------------------------------------
// POST /tasks/:id/evidence   multipart: file, role
// -----------------------------------------------------------------------
router.post('/tasks/:id/evidence', upload.single('file'), async (req, res) => {
  const task = getTaskOr404(req, res);
  if (!task) return;

  const { role } = req.body || {};
  if (!role) return res.status(400).json({ error: 'role is required (e.g. "serial_photo", "final_photo")' });
  if (!req.file) return res.status(400).json({ error: 'file is required' });

  const buffer = fs.readFileSync(req.file.path);
  const { data, source } = await extractEvidenceFromPhoto({ buffer, mimeType: req.file.mimetype, role });

  const id = randomUUID();
  const relativePath = path.relative(DATA_DIR, req.file.path);
  db.prepare(
    `INSERT INTO evidence (id, task_id, role, file_path, mime_type, extracted_json, extraction_source) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, task.id, role, relativePath, req.file.mimetype, JSON.stringify(data), source);
  logAgentRun(task.id, `extract_evidence:${role}`, { role, mimeType: req.file.mimetype }, { data, source });

  const evidence = db.prepare('SELECT * FROM evidence WHERE id = ?').get(id);
  res.status(201).json(serializeEvidence(evidence));
});

// -----------------------------------------------------------------------
// POST /tasks/:id/verify
// -----------------------------------------------------------------------
router.post('/tasks/:id/verify', (req, res) => {
  const task = getTaskOr404(req, res);
  if (!task) return;

  const checklist = getChecklistForTaskType(task.task_type);
  const claimRow = db.prepare('SELECT * FROM claims WHERE task_id = ? ORDER BY created_at DESC LIMIT 1').get(task.id);
  const evidenceRows = db.prepare('SELECT * FROM evidence WHERE task_id = ?').all(task.id);

  const claim = claimRow ? { data: JSON.parse(claimRow.extracted_json) } : null;
  const evidence = evidenceRows.map((e) => ({ role: e.role, data: JSON.parse(e.extracted_json) }));

  const result = verifyTask({ checklist, claim, evidence });

  const id = randomUUID();
  db.prepare(
    `INSERT INTO verification_results (id, task_id, decision, evidence_score, follow_up_question, fields_json) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, task.id, result.decision, result.evidence_score, result.follow_up_question, JSON.stringify(result.fields));

  db.prepare(`UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(
    STATUS_BY_DECISION[result.decision],
    task.id
  );

  logAgentRun(task.id, 'verify', { checklist_task_type: task.task_type }, result);

  res.json({ id, task_id: task.id, ...result });
});

// -----------------------------------------------------------------------
// GET /tasks/:id/report  — full evidence trail for the supervisor dashboard
// -----------------------------------------------------------------------
router.get('/tasks/:id/report', (req, res) => {
  const task = getTaskOr404(req, res);
  if (!task) return;

  const claim = db.prepare('SELECT * FROM claims WHERE task_id = ? ORDER BY created_at DESC LIMIT 1').get(task.id);
  const evidence = db.prepare('SELECT * FROM evidence WHERE task_id = ? ORDER BY created_at ASC').all(task.id);
  const verification = db
    .prepare('SELECT * FROM verification_results WHERE task_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(task.id);
  const agentRuns = db.prepare('SELECT * FROM agent_runs WHERE task_id = ? ORDER BY created_at ASC').all(task.id);

  res.json({
    task,
    claim: serializeClaim(claim),
    evidence: evidence.map(serializeEvidence),
    verification: serializeVerification(verification),
    agent_runs: agentRuns.map((r) => ({
      ...r,
      input: r.input_json ? JSON.parse(r.input_json) : null,
      output: r.output_json ? JSON.parse(r.output_json) : null,
    })),
  });
});

export default router;
