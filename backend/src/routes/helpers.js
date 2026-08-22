// Shared helpers for the route modules: task lookup, agent-run logging, and
// row -> JSON serializers. Kept in one place so claims/evidence/verifications
// (each a REST sub-resource of a task) don't duplicate this plumbing.

import { randomUUID } from 'node:crypto';
import { db } from '../db/index.js';

export function logAgentRun(taskId, step, input, output) {
  db.prepare(
    `INSERT INTO agent_runs (id, task_id, step, input_json, output_json) VALUES (?, ?, ?, ?, ?)`
  ).run(randomUUID(), taskId, step, JSON.stringify(input ?? null), JSON.stringify(output ?? null));
}

export function findTask(taskId) {
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
}

/** For routers mounted at /tasks/:taskId/... — 404s and returns null if the parent task doesn't exist. */
export function getTaskOr404(req, res) {
  const taskId = req.params.taskId || req.params.id;
  const task = findTask(taskId);
  if (!task) {
    res.status(404).json({ error: 'task not found' });
    return null;
  }
  return task;
}

export function serializeClaim(row) {
  return row ? { ...row, extracted: JSON.parse(row.extracted_json) } : null;
}

export function serializeEvidence(row) {
  return { ...row, extracted: JSON.parse(row.extracted_json), quality: JSON.parse(row.quality_json || '{}') };
}

export function serializeVerification(row) {
  if (!row) return null;
  return {
    ...row,
    fields: JSON.parse(row.fields_json),
    // citations_json is NULL on rows written before the RAG phase — treat
    // that as "no citations" rather than crashing on old data.
    citations: row.citations_json ? JSON.parse(row.citations_json) : [],
  };
}

export const STATUS_BY_DECISION = {
  VERIFIED: 'verified',
  NEED_MORE_EVIDENCE: 'need_more_evidence',
  IMAGE_UNCLEAR: 'image_unclear',
  INSUFFICIENT_IMAGE_EVIDENCE: 'insufficient_image_evidence',
  CONFLICT_HUMAN_REVIEW: 'conflict',
  INSUFFICIENT_EVIDENCE: 'insufficient_evidence',
};
