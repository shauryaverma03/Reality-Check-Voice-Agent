// Sub-resource: /api/v1/tasks/:taskId/claims
// A "claim" is one submission of the technician's voice/text report. Multiple
// claims can exist per task (a technician can correct themselves), which is
// why this is a collection, newest-first, rather than a single field on task.

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from '../db/index.js';
import { extractClaimFromVoice } from '../extraction/extract.js';
import { getTaskOr404, logAgentRun, serializeClaim } from './helpers.js';

const router = Router({ mergeParams: true });

// GET /api/v1/tasks/:taskId/claims
router.get('/', (req, res) => {
  const task = getTaskOr404(req, res);
  if (!task) return;
  const claims = db.prepare('SELECT * FROM claims WHERE task_id = ? ORDER BY created_at DESC').all(task.id);
  res.json(claims.map(serializeClaim));
});

// POST /api/v1/tasks/:taskId/claims   { raw_text }
router.post('/', async (req, res) => {
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
  logAgentRun(task.id, 'submit_claim', { raw_text }, { data, source });

  const claim = db.prepare('SELECT * FROM claims WHERE id = ?').get(id);
  res.status(201).json(serializeClaim(claim));
});

export default router;
