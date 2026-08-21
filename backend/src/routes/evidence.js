// Sub-resource: /api/v1/tasks/:taskId/evidence
// A task can carry any number of evidence items (a serial photo, a final
// photo, later maybe a doc scan), each tagged with a `role`.

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import multer from 'multer';
import { db, getChecklistForTaskType } from '../db/index.js';
import { extractEvidenceFromPhoto } from '../extraction/extract.js';
import { getTaskOr404, logAgentRun, serializeEvidence } from './helpers.js';

const router = Router({ mergeParams: true });

const DATA_DIR = path.join(process.cwd(), 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 8 * 1024 * 1024 } });

// GET /api/v1/tasks/:taskId/evidence
router.get('/', (req, res) => {
  const task = getTaskOr404(req, res);
  if (!task) return;
  const evidence = db.prepare('SELECT * FROM evidence WHERE task_id = ? ORDER BY created_at ASC').all(task.id);
  res.json(evidence.map(serializeEvidence));
});

// POST /api/v1/tasks/:taskId/evidence   multipart: file, role
router.post('/', upload.single('file'), async (req, res) => {
  const task = getTaskOr404(req, res);
  if (!task) return;

  const { role } = req.body || {};
  if (!role) return res.status(400).json({ error: 'role is required (e.g. "serial_photo", "final_photo")' });
  if (!req.file) return res.status(400).json({ error: 'file is required' });

  const buffer = fs.readFileSync(req.file.path);
  // Only image uploads go through the vision call — a non-image upload (e.g.
  // a PDF job card for a 'document' evidence field) has no OCR path here and
  // degrades straight to presence-only rather than wasting a failed API call.
  const checklist = getChecklistForTaskType(task.task_type);
  const { data, source } = req.file.mimetype.startsWith('image/')
    ? await extractEvidenceFromPhoto({ buffer, mimeType: req.file.mimetype, role, checklist })
    : { data: {}, source: 'none' };

  const id = randomUUID();
  const relativePath = path.relative(DATA_DIR, req.file.path);
  db.prepare(
    `INSERT INTO evidence (id, task_id, role, file_path, mime_type, extracted_json, extraction_source) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, task.id, role, relativePath, req.file.mimetype, JSON.stringify(data), source);
  logAgentRun(task.id, `extract_evidence:${role}`, { role, mimeType: req.file.mimetype }, { data, source });

  const evidence = db.prepare('SELECT * FROM evidence WHERE id = ?').get(id);
  res.status(201).json(serializeEvidence(evidence));
});

export default router;
