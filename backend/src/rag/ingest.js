// Knowledge ingestion command — npm run ingest:knowledge (from backend/).
//
//   backend/knowledge/<service-folder>/*.pdf
//     -> page-aware text extraction (rag/pdf.js)
//     -> normalization (rag/normalize.js)
//     -> per-page chunking (rag/chunk.js)
//     -> metadata (service_type from folder, manufacturer/model from
//        filename when confidently detectable — never guessed)
//     -> SQLite (knowledge_documents / knowledge_chunks)
//
// Deterministic and idempotent: re-running it re-indexes every file fresh
// (delete-then-reinsert keyed on file_path), so editing a PDF in place and
// re-running never leaves stale or duplicate chunks behind.
//
// Web-source ingestion (rag/ingestWeb.js) is invoked from here too, once
// that module exists — see the "web" section below.

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { db } from '../db/index.js';
import { extractPages } from './pdf.js';
import { chunkPages } from './chunk.js';

const KNOWLEDGE_ROOT = path.join(process.cwd(), 'knowledge'); // backend/knowledge

// Folder name (as given) -> task_type (as already used everywhere else in
// the app). Anything not listed here is skipped with a warning rather than
// guessed — service isolation depends on this mapping being explicit.
const SERVICE_FOLDER_TO_TASK_TYPE = {
  ac: 'ac-service',
  ro: 'ro-service',
  refrigerator: 'fridge-service',
  'washing-machine': 'washer-service',
};

const SERVICE_LABELS = {
  'ac-service': 'AC',
  'ro-service': 'RO',
  'fridge-service': 'Refrigerator',
  'washer-service': 'Washing Machine',
};

// Manufacturers we can confidently recognize from a filename. Extend this
// list as real documents from more manufacturers are added — never inferred
// from document content (too easy to false-positive on a brand mentioned in
// a warranty/legal boilerplate paragraph, not the manual's actual subject).
const KNOWN_MANUFACTURERS = [
  'carrier', 'lg', 'samsung', 'whirlpool', 'voltas', 'daikin', 'bluestar',
  'haier', 'godrej', 'ifb', 'bosch', 'panasonic', 'hitachi', 'condair',
];

function detectManufacturer(filename) {
  const lower = filename.toLowerCase();
  const found = KNOWN_MANUFACTURERS.find((m) => lower.includes(m));
  return found ? found.charAt(0).toUpperCase() + found.slice(1) : null;
}

/** Model tokens look like "24VNA6" — digits, then letters, then optional digits, glued. Deliberately conservative: only fires on tokens that clearly mix letters and digits in that shape, so ordinary words never match. */
function detectModel(filename) {
  const base = filename.replace(/\.[a-z0-9]+$/i, '');
  const tokens = base.split(/[-_\s]+/);
  const modelTokens = tokens.filter((t) => /^\d{1,3}[a-z]{2,6}\d{0,3}$/i.test(t));
  return modelTokens.length > 0 ? modelTokens.map((t) => t.toUpperCase()).join('/') : null;
}

function humanizeTitle(filename, manufacturer, model) {
  if (manufacturer || model) {
    return [manufacturer, model, 'Service Manual'].filter(Boolean).join(' ');
  }
  const base = filename.replace(/\.[a-z0-9]+$/i, '');
  return base
    .split(/[-_]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .replace(/\bAc\b/g, 'AC')
    .replace(/\bRo\b/g, 'RO');
}

/** Delete any existing document at this file_path, then insert fresh — makes re-running the ingest command safe (no duplicate/stale chunks). */
function upsertDocument({ taskType, title, filePath, mimeType, manufacturer, model, sourceType }) {
  const existing = db.prepare('SELECT id FROM knowledge_documents WHERE file_path = ?').get(filePath);
  if (existing) {
    db.prepare('DELETE FROM knowledge_chunks WHERE document_id = ?').run(existing.id);
    db.prepare('DELETE FROM knowledge_documents WHERE id = ?').run(existing.id);
  }
  const id = randomUUID();
  db.prepare(
    `INSERT INTO knowledge_documents (id, task_type, title, file_path, mime_type, manufacturer, model, source_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, taskType, title, filePath, mimeType, manufacturer, model, sourceType);
  return id;
}

function insertChunks(documentId, chunks) {
  const insertOne = db.prepare(
    `INSERT INTO knowledge_chunks (id, document_id, chunk_index, text, page, section) VALUES (?, ?, ?, ?, ?, ?)`
  );
  const insertMany = db.transaction((rows) => {
    for (const row of rows) insertOne.run(row.id, documentId, row.chunkIndex, row.text, row.page ?? null, row.section ?? null);
  });
  insertMany(chunks.map((c, i) => ({ id: randomUUID(), chunkIndex: i, text: c.text, page: c.page, section: c.section })));
}

async function ingestPdf(taskType, absPath, relPath) {
  const filename = path.basename(absPath);
  const buffer = fs.readFileSync(absPath);
  const pages = await extractPages(buffer);
  if (pages.length === 0) {
    console.warn(`  [skip] ${filename} — no text could be extracted`);
    return { chunks: 0 };
  }

  const chunks = chunkPages(pages);
  const withSection = chunks.filter((c) => c.section).length;

  const manufacturer = detectManufacturer(filename);
  const model = detectModel(filename);
  const title = humanizeTitle(filename, manufacturer, model);

  const documentId = upsertDocument({
    taskType,
    title,
    filePath: relPath,
    mimeType: 'application/pdf',
    manufacturer,
    model,
    sourceType: 'pdf',
  });
  insertChunks(documentId, chunks);

  const meta = [manufacturer, model].filter(Boolean).join(' ');
  console.log(
    `  ✓ ${filename}${meta ? ` (${meta})` : ''} — ${pages.length} pages, ${chunks.length} chunks (${withSection} with a detected section)`
  );
  return { chunks: chunks.length };
}

async function ingestPdfsForService(folderName, taskType) {
  const dir = path.join(KNOWLEDGE_ROOT, folderName);
  if (!fs.existsSync(dir)) return { documents: 0, chunks: 0 };

  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pdf'));
  let totalChunks = 0;
  for (const file of files) {
    const absPath = path.join(dir, file);
    const relPath = path.relative(process.cwd(), absPath);
    const { chunks } = await ingestPdf(taskType, absPath, relPath);
    totalChunks += chunks;
  }
  return { documents: files.length, chunks: totalChunks };
}

async function main() {
  console.log('\nRealityCheck knowledge ingestion\n');
  console.log('PDF:');

  const pdfTotals = { documents: 0, chunks: 0 };
  for (const [folder, taskType] of Object.entries(SERVICE_FOLDER_TO_TASK_TYPE)) {
    console.log(`${SERVICE_LABELS[taskType]}:`);
    const result = await ingestPdfsForService(folder, taskType);
    if (result.documents === 0) {
      console.log('  (no PDFs found)');
    }
    pdfTotals.documents += result.documents;
    pdfTotals.chunks += result.chunks;
  }

  console.log(`\nKnowledge ingestion complete\n`);
  console.log(`Total: ${pdfTotals.documents} document(s), ${pdfTotals.chunks} chunk(s)\n`);
}

main().catch((err) => {
  console.error('[ingest] fatal error:', err);
  process.exitCode = 1;
});
