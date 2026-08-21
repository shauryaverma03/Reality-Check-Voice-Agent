// Resource: /api/v1/tasks
// Top-level `tasks` resource plus its REST sub-resources:
//   /tasks/:taskId/claims          (claims.js)
//   /tasks/:taskId/evidence        (evidence.js)
//   /tasks/:taskId/verifications   (verifications.js)
// and one non-strict-REST convenience aggregate, /tasks/:id/report, which
// joins task + latest claim + evidence + latest verification + agent-run log
// into a single read for the supervisor dashboard (documented as a "view",
// not a resource, so it doesn't muddy the collection semantics above).

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db, getChecklistForTaskType } from '../db/index.js';
import claimsRouter from './claims.js';
import evidenceRouter from './evidence.js';
import verificationsRouter from './verifications.js';
import { findTask, logAgentRun, serializeClaim, serializeEvidence, serializeVerification } from './helpers.js';

const router = Router();

function getTaskOr404(req, res) {
  const task = findTask(req.params.id);
  if (!task) {
    res.status(404).json({ error: 'task not found' });
    return null;
  }
  return task;
}

// POST /api/v1/tasks
router.post('/', (req, res) => {
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

  res.status(201).json(findTask(id));
});

// GET /api/v1/tasks?status=&task_type=&limit=&offset=
router.get('/', (req, res) => {
  const { status, task_type: taskType } = req.query;
  const limit = Math.min(Number.parseInt(req.query.limit, 10) || 50, 200);
  const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);

  const clauses = [];
  const params = {};
  if (status) {
    clauses.push('t.status = @status');
    params.status = status;
  }
  if (taskType) {
    clauses.push('t.task_type = @task_type');
    params.task_type = taskType;
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

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
      ${where}
      ORDER BY t.created_at DESC
      LIMIT @limit OFFSET @offset`
    )
    .all({ ...params, limit, offset });

  const total = db
    .prepare(`SELECT COUNT(*) AS n FROM tasks t ${where}`)
    .get(params).n;

  res.json({ data: tasks, pagination: { total, limit, offset } });
});

// GET /api/v1/tasks/:id
router.get('/:id', (req, res) => {
  const task = getTaskOr404(req, res);
  if (!task) return;
  res.json(task);
});

// PATCH /api/v1/tasks/:id  { unit_id?, technician? }
router.patch('/:id', (req, res) => {
  const task = getTaskOr404(req, res);
  if (!task) return;
  const unit_id = req.body?.unit_id ?? task.unit_id;
  const technician = req.body?.technician ?? task.technician;
  db.prepare(`UPDATE tasks SET unit_id = ?, technician = ?, updated_at = datetime('now') WHERE id = ?`).run(
    unit_id,
    technician,
    task.id
  );
  res.json(findTask(task.id));
});

// GET /api/v1/tasks/:id/report — combined convenience view
router.get('/:id/report', (req, res) => {
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

router.use('/:taskId/claims', claimsRouter);
router.use('/:taskId/evidence', evidenceRouter);
router.use('/:taskId/verifications', verificationsRouter);

export default router;
