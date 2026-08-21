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

/**
 * Pure ranking function — no DB dependency, so it's directly unit-testable
 * and directly reusable by the eval harness with fixture chunks.
 * @param {string} query
 * @param {{ chunkId, documentId, documentTitle, text }[]} chunks
 * @param {number} [k]
 * @returns {{ chunkId, documentId, documentTitle, text, score }[]}
 */
export function rankChunks(query, chunks, k = 3) {
  if (!chunks.length) return [];

  const chunkTokenLists = chunks.map((c) => tokenize(c.text));
  const idf = buildIdf(chunkTokenLists);
  const queryVec = tfidfVector(tokenize(query), idf);

  return chunks
    .map((chunk, i) => ({
      chunkId: chunk.chunkId,
      documentId: chunk.documentId,
      documentTitle: chunk.documentTitle,
      text: chunk.text,
      score: cosineSimilarity(queryVec, tfidfVector(chunkTokenLists[i], idf)),
    }))
    .filter((r) => r.score >= SIMILARITY_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/** Every chunk that could apply to this task_type: its own docs + "general" (task_type-NULL) docs. */
export function fetchCandidateChunks(taskType) {
  const rows = db
    .prepare(
      `SELECT c.id AS chunk_id, c.document_id, c.text, d.title AS document_title
       FROM knowledge_chunks c
       JOIN knowledge_documents d ON d.id = c.document_id
       WHERE d.task_type = ? OR d.task_type IS NULL`
    )
    .all(taskType);
  return rows.map((r) => ({
    chunkId: r.chunk_id,
    documentId: r.document_id,
    documentTitle: r.document_title,
    text: r.text,
  }));
}

/**
 * @param {{ taskType: string, query: string, k?: number }} input
 */
export function retrieve({ taskType, query, k = 3 }) {
  return rankChunks(query, fetchCandidateChunks(taskType), k);
}

/**
 * Field-aware query composition — task_type + field key/label + the value
 * actually extracted for this field (if any) + the technician's raw claim
 * text. Deliberately NOT just the raw claim text: this lets a chunk that's
 * specifically about (e.g.) tds_output outrank an unrelated chunk even when
 * both appear in the same manual.
 */
export function buildFieldQuery({ taskType, field, extractedValue, rawText }) {
  const parts = [taskType, field.key, field.label];
  if (field.unit) parts.push(field.unit);
  if (extractedValue !== undefined && extractedValue !== null && extractedValue !== '') {
    parts.push(String(extractedValue));
  }
  if (rawText) parts.push(rawText);
  return parts.filter(Boolean).join(' ');
}
