// Shared helpers for the route modules: task lookup, agent-run logging, and
// row -> JSON serializers. Kept in one place so claims/evidence/verifications
// (each a REST sub-resource of a task) don't duplicate this plumbing.

import { randomUUID } from 'node:crypto';
import { db } from '../db/index.js';

/**
 * @param {object} [telemetry] — an observability/telemetry.js record. Every
 *   field is optional: steps that don't call a model (or predate this) simply
 *   store NULLs, which the observability aggregates skip rather than count as
 *   zero-latency/zero-cost work.
 */
export function logAgentRun(taskId, step, input, output, telemetry = null) {
  const t = telemetry || {};
  db.prepare(
    `INSERT INTO agent_runs (
       id, task_id, step, input_json, output_json,
       duration_ms, mode, model, prompt_key, prompt_version, prompt_hash,
       input_tokens, output_tokens, cost_usd, rate_tier, fallback_reason
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    randomUUID(),
    taskId,
    step,
    JSON.stringify(input ?? null),
    JSON.stringify(output ?? null),
    t.duration_ms ?? null,
    t.mode ?? null,
    t.model ?? null,
    t.prompt_key ?? null,
    t.prompt_version ?? null,
    t.prompt_hash ?? null,
    t.input_tokens ?? null,
    t.output_tokens ?? null,
    t.cost_usd ?? null,
    t.rate_tier ?? null,
    t.fallback_reason ?? null
  );
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
    // functional_json / verification_scope are NULL on rows written before
    // the compliance-vs-function split — null means "this older result never
    // asked the functional question", which the UI renders as exactly that
    // rather than as a passing functional check.
    functional_verification: row.functional_json ? JSON.parse(row.functional_json) : null,
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
