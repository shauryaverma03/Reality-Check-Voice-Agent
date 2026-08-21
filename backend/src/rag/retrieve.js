// Lightweight retrieval: TF-IDF vectors built on the fly over a task_type's
// knowledge chunks, ranked by cosine similarity against a field-aware query.
// No embeddings API, no API key, no external vector-DB service (Pinecone,
// Qdrant, etc.) — plain in-process JS math, so retrieval always works,
// online or offline, exactly like the rest of this app's extraction layer.
//
// Two layers, kept separate on purpose:
//   rankChunks(query, chunks)   — pure, DB-free, easy to unit-test
//   fetchCandidateChunks(taskType) — the only part that touches SQLite
//   retrieve({ taskType, query, k }) — glues the two together for routes

import { db } from '../db/index.js';

const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'in', 'on', 'for', 'to', 'is', 'are', 'and', 'or',
  'at', 'by', 'with', 'this', 'that', 'it', 'be', 'was', 'were', 'as', 'from',
]);

// A chunk only counts as "found" above this cosine-similarity score; below
// it, retrieval is treated as having found nothing (feeds INSUFFICIENT_EVIDENCE
// for fields that require reference backing).
export const SIMILARITY_THRESHOLD = 0.15;

function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !STOPWORDS.has(t));
}

function termFreq(tokens) {
  const tf = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  return tf;
}

function buildIdf(allTokenLists) {
  const docFreq = new Map();
  for (const tokens of allTokenLists) {
    for (const term of new Set(tokens)) docFreq.set(term, (docFreq.get(term) || 0) + 1);
  }
  const n = allTokenLists.length;
  const idf = new Map();
  for (const [term, count] of docFreq) idf.set(term, Math.log((n + 1) / (count + 1)) + 1);
  return idf;
}

function tfidfVector(tokens, idf) {
  const tf = termFreq(tokens);
  const vec = new Map();
  const unseenIdf = Math.log(2); // fallback weight for a query term absent from the corpus
  for (const [term, count] of tf) {
    vec.set(term, count * (idf.get(term) ?? unseenIdf));
  }
  return vec;
}

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [term, weight] of a) {
    normA += weight * weight;
    if (b.has(term)) dot += weight * b.get(term);
  }
  for (const weight of b.values()) normB += weight * weight;
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// A chunk from a document whose manufacturer or model is literally named in
// the query text gets a small deterministic score bonus — this is how "if
// the task mentions a model and the knowledge base has a matching model,
// prefer that source" (never universally applying a model-specific spec)
// is implemented, without needing a dedicated model field on tasks: the
// signal is whatever the technician's own claim text says.
const MODEL_MATCH_BONUS = 0.05;

function modelMatchBonus(chunk, queryLower) {
  const candidates = [chunk.manufacturer, chunk.model].filter(Boolean);
  return candidates.some((c) => queryLower.includes(c.toLowerCase())) ? MODEL_MATCH_BONUS : 0;
}

/**
 * Pure ranking function — no DB dependency, so it's directly unit-testable
 * and directly reusable by the eval harness with fixture chunks.
 * @param {string} query
 * @param {{ chunkId, documentId, documentTitle, chunkIndex, text, manufacturer?, model?, sourceType?, sourceUrl?, page?, section? }[]} chunks
 * @param {number} [k]
 * @returns {{ chunkId, documentId, documentTitle, chunkIndex, text, score, manufacturer, model, sourceType, sourceUrl, page, section }[]}
 */
export function rankChunks(query, chunks, k = 3) {
  if (!chunks.length) return [];

  const chunkTokenLists = chunks.map((c) => tokenize(c.text));
  const idf = buildIdf(chunkTokenLists);
  const queryVec = tfidfVector(tokenize(query), idf);
  const queryLower = query.toLowerCase();

  return chunks
    .map((chunk, i) => ({
      chunkId: chunk.chunkId,
      documentId: chunk.documentId,
      documentTitle: chunk.documentTitle,
      chunkIndex: chunk.chunkIndex,
      text: chunk.text,
      manufacturer: chunk.manufacturer ?? null,
      model: chunk.model ?? null,
      sourceType: chunk.sourceType ?? 'pdf',
      sourceUrl: chunk.sourceUrl ?? null,
      page: chunk.page ?? null,
      section: chunk.section ?? null,
      score: cosineSimilarity(queryVec, tfidfVector(chunkTokenLists[i], idf)) + modelMatchBonus(chunk, queryLower),
    }))
    .filter((r) => r.score >= SIMILARITY_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/** Every chunk that could apply to this task_type: its own docs + "general" (task_type-NULL) docs. */
export function fetchCandidateChunks(taskType) {
  const rows = db
    .prepare(
      `SELECT c.id AS chunk_id, c.document_id, c.chunk_index, c.text, c.page, c.section,
              d.title AS document_title, d.manufacturer, d.model, d.source_type, d.source_url
       FROM knowledge_chunks c
       JOIN knowledge_documents d ON d.id = c.document_id
       WHERE d.task_type = ? OR d.task_type IS NULL`
    )
    .all(taskType);
  return rows.map((r) => ({
    chunkId: r.chunk_id,
    documentId: r.document_id,
    documentTitle: r.document_title,
    chunkIndex: r.chunk_index,
    text: r.text,
    manufacturer: r.manufacturer,
    model: r.model,
    sourceType: r.source_type,
    sourceUrl: r.source_url,
    page: r.page,
    section: r.section,
  }));
}

/**
 * @param {{ taskType: string, query: string, k?: number }} input
 */
export function retrieve({ taskType, query, k = 3 }) {
  return rankChunks(query, fetchCandidateChunks(taskType), k);
}

// ---------------------------------------------------------------------------
// Conflicting-reference detection — "never silently merge contradictory
// specs." Deliberately conservative: only flags a conflict when two DIFFERENT
// documents each state a confidently-extractable numeric range in the SAME
// unit, and those ranges don't overlap at all. Anything less certain (no
// range found, only one source, mismatched/absent units) is not a conflict —
// silence here just means "cite the top match," never "invent a comparison."
// ---------------------------------------------------------------------------

const RANGE_PATTERN = /(?:between\s+)?(-?\d+(?:\.\d+)?)\s*(?:-|–|to|and)\s*(-?\d+(?:\.\d+)?)\s*(ppm|bar|psi|°?c\b|°?f\b|celsius|fahrenheit)?/i;

function extractRange(text) {
  const match = text.match(RANGE_PATTERN);
  if (!match) return null;
  const min = Number.parseFloat(match[1]);
  const max = Number.parseFloat(match[2]);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) return null;
  const unit = (match[3] || '').toLowerCase().replace(/[°\s]/g, '');
  return { min, max, unit };
}

function rangesConflict(a, b) {
  if (a.unit && b.unit && a.unit !== b.unit) return false; // different units — not a safe comparison, not a claimed conflict
  return Math.min(a.max, b.max) - Math.max(a.min, b.min) < 0; // zero overlap = genuine disagreement
}

/**
 * @param {ReturnType<typeof rankChunks>} results — top-k results for one field's query
 * @returns {{ a: object, b: object, rangeA: object, rangeB: object } | null}
 */
export function detectRangeConflict(results) {
  const byDocument = new Map();
  for (const r of results) {
    if (!byDocument.has(r.documentId)) byDocument.set(r.documentId, r);
  }
  const withRanges = [...byDocument.values()]
    .map((result) => ({ result, range: extractRange(result.text) }))
    .filter((x) => x.range);

  for (let i = 0; i < withRanges.length; i++) {
    for (let j = i + 1; j < withRanges.length; j++) {
      if (rangesConflict(withRanges[i].range, withRanges[j].range)) {
        return { a: withRanges[i].result, b: withRanges[j].result, rangeA: withRanges[i].range, rangeB: withRanges[j].range };
      }
    }
  }
  return null;
}

/**
 * Well-known industry abbreviation expansions for specific checklist field
 * keys — TF-IDF does exact token matching, so a reference source that spells
 * out "Total Dissolved Solids" instead of using the abbreviation "TDS"
 * would otherwise never surface for a tds_output query. This is a real,
 * defensible synonym (the abbreviation's actual expansion), not an invented
 * one — kept as a small explicit map rather than generic synonym expansion,
 * which would risk pulling in loosely-related content.
 */
const FIELD_QUERY_SYNONYMS = {
  tds_output: 'total dissolved solids',
};

/**
 * Field-aware query composition — task_type + field key/label + the value
 * actually extracted for this field (if any) + the technician's raw claim
 * text. Deliberately NOT just the raw claim text: this lets a chunk that's
 * specifically about (e.g.) tds_output outrank an unrelated chunk even when
 * both appear in the same manual.
 */
export function buildFieldQuery({ taskType, field, extractedValue, rawText }) {
  const parts = [taskType, field.key, field.label, FIELD_QUERY_SYNONYMS[field.key]];
  if (field.unit) parts.push(field.unit);
  if (extractedValue !== undefined && extractedValue !== null && extractedValue !== '') {
    parts.push(String(extractedValue));
  }
  if (rawText) parts.push(rawText);
  return parts.filter(Boolean).join(' ');
}
