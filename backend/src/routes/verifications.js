// Sub-resource: /api/v1/tasks/:taskId/verifications
// Each POST runs the verifier fresh against the task's latest claim + all
// evidence and creates a new verification_result — a history of every
// verification attempt, not just the latest one (so a technician can submit
// a follow-up and re-verify without losing the prior attempt's record).
//
// For any checklist field flagged `needsReference: true`, this also runs a
// RAG retrieval pass (rag/retrieve.js) against the knowledge base BEFORE
// verifying, and hands the result to verifyTaskWithReferences() as
// `references` — the verifier itself never calls the knowledge base
// directly, keeping the "what evidence did we actually check" boundary
// explicit.

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db, getChecklistForTaskType } from '../db/index.js';
import { verifyTaskWithReferences } from '../verifier.js';
import { retrieve, buildFieldQuery, detectRangeConflict } from '../rag/retrieve.js';
import { getTaskOr404, logAgentRun, serializeVerification, STATUS_BY_DECISION } from './helpers.js';
import { stepTelemetry } from '../observability/telemetry.js';

const router = Router({ mergeParams: true });

/** Best-effort "what value do we currently have for this field" — voice claim first, then any evidence item. Used only to enrich the RAG query string, never fed back into the verifier's own logic. */
function extractedValueForField(field, claim, evidence) {
  if (claim?.data && Object.prototype.hasOwnProperty.call(claim.data, field.key)) {
    return claim.data[field.key];
  }
  for (const item of evidence) {
    if (item.data && Object.prototype.hasOwnProperty.call(item.data, field.key)) {
      return item.data[field.key];
    }
  }
  return undefined;
}

/** The clean, technician-facing citation shape — everything the UI needs to render a real citation, nothing internal (no chunk id, no raw candidate list; that detail lives only in the agent_runs retrieval trace). */
function toCitation(chunk) {
  return {
    document_title: chunk.documentTitle,
    source_type: chunk.sourceType,
    manufacturer: chunk.manufacturer,
    model: chunk.model,
    page: chunk.page,
    section: chunk.section,
    url: chunk.sourceUrl,
    snippet: chunk.text.length > 240 ? `${chunk.text.slice(0, 240)}…` : chunk.text,
    score: Number(chunk.score.toFixed(3)),
  };
}

// GET /api/v1/tasks/:taskId/verifications
router.get('/', (req, res) => {
  const task = getTaskOr404(req, res);
  if (!task) return;
  const rows = db
    .prepare('SELECT * FROM verification_results WHERE task_id = ? ORDER BY created_at DESC')
    .all(task.id);
  res.json(rows.map(serializeVerification));
});

// POST /api/v1/tasks/:taskId/verifications
router.post('/', (req, res) => {
  const task = getTaskOr404(req, res);
  if (!task) return;

  const checklist = getChecklistForTaskType(task.task_type);
  const claimRow = db.prepare('SELECT * FROM claims WHERE task_id = ? ORDER BY created_at DESC LIMIT 1').get(task.id);

  // "State Your Claim" is mandatory (spec: block progression to verification
  // without it) — enforced server-side, not just by disabling a frontend
  // button, since the API is the actual authority on whether a claim exists.
  if (!claimRow) {
    return res.status(400).json({
      error: 'A claim is required before verification. Submit "State Your Claim" for this job first.',
      code: 'CLAIM_REQUIRED',
    });
  }

  // ORDER BY matters here, not just for display: the verifier treats the
  // MOST RECENT evidence item per role as authoritative (see
  // evaluateEvidencePresenceField) so replacing a bad photo with a good one
  // actually clears the problem, instead of the old upload permanently
  // blocking that field.
  const evidenceRows = db.prepare('SELECT * FROM evidence WHERE task_id = ? ORDER BY created_at ASC').all(task.id);

  const claim = { data: JSON.parse(claimRow.extracted_json), raw_text: claimRow.raw_text };
  const evidence = evidenceRows.map((e) => ({
    role: e.role,
    data: JSON.parse(e.extracted_json),
    quality: e.quality_json ? JSON.parse(e.quality_json) : null,
    extractionSource: e.extraction_source,
  }));

  // The Start-a-Job wizard's own structured record for this task — the
  // verifier treats this as a real source (see verifier.js's
  // collectSources), not a fallback bolted on here. This is what stops
  // machine_id from being reported "missing" just because claim extraction
  // failed to re-derive information the job was already created with.
  const taskContext = { unit_id: task.unit_id };

  // RAG retrieval — only for fields the checklist says need reference backing.
  // Fetches top-3 (not just top-1) so detectRangeConflict can tell "two
  // different sources genuinely disagree" apart from "these are just two
  // chunks of the same story" before deciding what to cite.
  const references = {};
  const retrievalLog = [];
  const retrievalStarted = performance.now();
  for (const field of checklist) {
    if (!field.needsReference) continue;
    const extractedValue = extractedValueForField(field, claim, evidence);
    const query = buildFieldQuery({ taskType: task.task_type, field, extractedValue, rawText: claim?.raw_text });
    const results = retrieve({ taskType: task.task_type, query, k: 3 });
    const conflict = detectRangeConflict(results);
    const top = results[0];

    retrievalLog.push({
      field_key: field.key,
      query,
      found: Boolean(top),
      conflict: conflict ? { a: toCitation(conflict.a), b: toCitation(conflict.b) } : null,
      candidates: results.map(toCitation),
    });

    if (conflict) {
      references[field.key] = { conflict: { a: toCitation(conflict.a), b: toCitation(conflict.b) } };
    } else if (top) {
      references[field.key] = { citation: toCitation(top) };
    }
  }

  const retrievalTelemetry = stepTelemetry(retrievalStarted, { fields_retrieved: retrievalLog.length });

  const verifyStarted = performance.now();
  const result = verifyTaskWithReferences({ checklist, claim, evidence, references, taskContext });
  const verifyTelemetry = stepTelemetry(verifyStarted);

  const id = randomUUID();
  db.prepare(
    `INSERT INTO verification_results (id, task_id, decision, evidence_score, follow_up_question, fields_json, citations_json, functional_json, verification_scope) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    task.id,
    result.decision,
    result.evidence_score,
    result.follow_up_question,
    JSON.stringify(result.fields),
    JSON.stringify(result.citations || []),
    JSON.stringify(result.functional_verification || null),
    result.verification_scope || null
  );

  db.prepare(`UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(
    STATUS_BY_DECISION[result.decision],
    task.id
  );

  if (retrievalLog.length > 0) {
    logAgentRun(task.id, 'rag_retrieval', { fields: retrievalLog.map((r) => r.field_key) }, retrievalLog, retrievalTelemetry);
  }
  logAgentRun(task.id, 'verify', { checklist_task_type: task.task_type }, result, verifyTelemetry);

  const row = db.prepare('SELECT * FROM verification_results WHERE id = ?').get(id);
  res.status(201).json(serializeVerification(row));
});

export default router;
