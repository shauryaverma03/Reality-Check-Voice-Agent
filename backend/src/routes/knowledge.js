// Resource: /api/v1/knowledge
// The reference knowledge base — manufacturer manuals / SOPs / spec sheets,
// uploaded by a supervisor. This is intentionally a SEPARATE system from
// task evidence (claims/evidence tables): a manual is never attached to a
// task and never counts as technician evidence. It only exists to be
// retrieved by rag/retrieve.js during verification and cited back.

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import multer from 'multer';
import { db } from '../db/index.js';
import { extractText } from '../rag/pdf.js';
import { chunkText } from '../rag/chunk.js';

const router = Router();

const DATA_DIR = path.join(process.cwd(), 'data');
const KNOWLEDGE_DIR = path.join(DATA_DIR, 'knowledge');
fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
const upload = multer({ dest: KNOWLEDGE_DIR, limits: { fileSize: 15 * 1024 * 1024 } });

// POST /api/v1/knowledge   multipart: file, title?, task_type?
// task_type omitted/empty = applies to every service ("general" reference).
router.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file is required' });
  const { title, task_type } = req.body || {};

  const buffer = fs.readFileSync(req.file.path);
  const text = await extractText(buffer, req.file.mimetype);
  if (!text.trim()) {
    fs.unlinkSync(req.file.path);
    return res.status(422).json({ error: 'could not extract any text from this file (unsupported format or empty)' });
  }
  const chunks = chunkText(text);

  const docId = randomUUID();
  const relativePath = path.relative(DATA_DIR, req.file.path);
  db.prepare(
    `INSERT INTO knowledge_documents (id, task_type, title, file_path, mime_type) VALUES (?, ?, ?, ?, ?)`
  ).run(docId, task_type || null, title || req.file.originalname, relativePath, req.file.mimetype);

  const insertChunk = db.prepare(
    `INSERT INTO knowledge_chunks (id, document_id, chunk_index, text) VALUES (?, ?, ?, ?)`
  );
  const insertMany = db.transaction((rows) => {
    for (const row of rows) insertChunk.run(row.id, row.document_id, row.chunk_index, row.text);
  });
  insertMany(chunks.map((chunkedText, i) => ({ id: randomUUID(), document_id: docId, chunk_index: i, text: chunkedText })));

  const doc = db.prepare('SELECT * FROM knowledge_documents WHERE id = ?').get(docId);
  res.status(201).json({ ...doc, chunk_count: chunks.length });
});

// GET /api/v1/knowledge?task_type=
// Lists documents scoped to a task_type plus every "general" (task_type
// NULL) document, or everything if task_type is omitted.
router.get('/', (req, res) => {
  const { task_type } = req.query;
  const rows = task_type
    ? db
        .prepare('SELECT * FROM knowledge_documents WHERE task_type = ? OR task_type IS NULL ORDER BY created_at DESC')
        .all(task_type)
    : db.prepare('SELECT * FROM knowledge_documents ORDER BY created_at DESC').all();

  const withCounts = rows.map((doc) => ({
    ...doc,
    chunk_count: db.prepare('SELECT COUNT(*) AS n FROM knowledge_chunks WHERE document_id = ?').get(doc.id).n,
  }));
  res.json(withCounts);
});

export default router;
