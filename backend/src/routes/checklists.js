// Resource: /api/v1/checklists
// Exposes the procedure checklists as a first-class, browsable resource
// instead of leaving them as internal config only the server reads.

import { Router } from 'express';
import { db } from '../db/index.js';

const router = Router();

function serialize(row) {
  return { task_type: row.task_type, fields: JSON.parse(row.fields_json), created_at: row.created_at };
}

// GET /api/v1/checklists
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM checklists ORDER BY task_type').all();
  res.json(rows.map(serialize));
});

// GET /api/v1/checklists/:taskType
router.get('/:taskType', (req, res) => {
  const row = db.prepare('SELECT * FROM checklists WHERE task_type = ?').get(req.params.taskType);
  if (!row) return res.status(404).json({ error: `no checklist for task_type "${req.params.taskType}"` });
  res.json(serialize(row));
});

export default router;
