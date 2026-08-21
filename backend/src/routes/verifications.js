// Sub-resource: /api/v1/tasks/:taskId/verifications
// Each POST runs the verifier fresh against the task's latest claim + all
// evidence and creates a new verification_result — a history of every
// verification attempt, not just the latest one (so a technician can submit
// a follow-up and re-verify without losing the prior attempt's record).

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db, getChecklistForTaskType } from '../db/index.js';
import { verifyTask } from '../verifier.js';
import { getTaskOr404, logAgentRun, serializeVerification, STATUS_BY_DECISION } from './helpers.js';

const router = Router({ mergeParams: true });

// GET /api/v1/tasks/:taskId/verifications
router.get('/', (req, res) => {
  const task = getTaskOr404(req, res);
  if (!task) return;
  const rows = db
    .prepare('SELECT * FROM verification_results WHERE task_id = ? ORDER BY created_at DESC')
    .all(task.id);
  res.json(rows.map(serializeVerification));
});

// POST /api/v1/tasks/:taskId/verifications
router.post('/', (req, res) => {
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

  const row = db.prepare('SELECT * FROM verification_results WHERE id = ?').get(id);
  res.status(201).json(serializeVerification(row));
});

export default router;
