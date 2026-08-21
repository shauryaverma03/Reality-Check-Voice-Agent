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
  return { ...row, extracted: JSON.parse(row.extracted_json) };
}

export function serializeVerification(row) {
  return row ? { ...row, fields: JSON.parse(row.fields_json) } : null;
}

export const STATUS_BY_DECISION = {
  VERIFIED: 'verified',
  NEED_MORE_EVIDENCE: 'need_more_evidence',
  CONFLICT_HUMAN_REVIEW: 'conflict',
};
