// Resource: /api/v1/reports
// Supervisor reporting — daily and custom date-range summaries, plus a
// suspicious-activity list and a CSV export. Reads only from the existing
// tasks/verification_results tables (each task's LATEST verification, same
// pattern tasks.js's GET / already uses) — no new database, no new source
// of truth, exactly the data already being stored per task.

import { Router } from 'express';
import { db, getChecklistForTaskType } from '../db/index.js';

const router = Router();

const LOW_SCORE_THRESHOLD = 50; // below this, a VERIFIED-adjacent score is still worth a supervisor's attention
const REPEATED_ISSUE_THRESHOLD = 3; // this many non-verified jobs by the same technician, in the same window, is worth flagging as a pattern (not a one-off)

function parseDateRange(query) {
  const today = new Date().toISOString().slice(0, 10);
  const from = query.from || query.date || today;
  const to = query.to || query.date || from;
  return { from, to };
}

/** Every task with a verification result, in range, its latest attempt only
 * — same "latest per task" join tasks.js's list endpoint already uses. */
function tasksInRange(from, to) {
  return db
    .prepare(
      `SELECT t.*,
        vr.id AS verification_id,
        vr.decision AS latest_decision,
        vr.evidence_score AS latest_score,
        vr.fields_json AS latest_fields_json,
        vr.follow_up_question AS latest_follow_up,
        vr.created_at AS verified_at
      FROM tasks t
      LEFT JOIN verification_results vr ON vr.id = (
        SELECT id FROM verification_results WHERE task_id = t.id ORDER BY created_at DESC LIMIT 1
      )
      WHERE date(t.created_at) BETWEEN date(?) AND date(?)
      ORDER BY t.created_at DESC`
    )
    .all(from, to);
}

/** Field-level detail behind a decision: which kind of "bad" it actually
 * is (out-of-range vs. a genuine claim/evidence mismatch vs. unclear image)
 * — the report breaks these out separately even though today they can share
 * a top-level decision (CONFLICT_HUMAN_REVIEW covers both contradiction and
 * out_of_range). */
function classifyFields(fieldsJson) {
  const empty = { hasMismatch: false, hasOutOfRange: false, hasUnclear: false, hasContentUnverified: false };
  if (!fieldsJson) return empty;
  let fields;
  try {
    fields = JSON.parse(fieldsJson);
  } catch {
    return empty;
  }
  return {
    hasMismatch: fields.some((f) => f.mismatch),
    hasOutOfRange: fields.some((f) => f.status === 'out_of_range'),
    hasUnclear: fields.some((f) => f.status === 'unclear'),
    hasContentUnverified: fields.some((f) => f.status === 'content_unverified'),
  };
}

/**
 * Never an accusation of fraud — every reason is phrased as something a
 * supervisor should look at, not a verdict. A task can carry more than one
 * reason; `repeatedByTechnician` is computed across the whole range, not
 * per-task, so it's passed in rather than recomputed per call.
 */
function suspiciousReasons(task, repeatedByTechnician) {
  const reasons = [];
  const { hasMismatch, hasOutOfRange, hasUnclear, hasContentUnverified } = classifyFields(task.latest_fields_json);

  if (hasMismatch) reasons.push('Technician claim does not match uploaded evidence — requires supervisor review');
  if (hasOutOfRange) reasons.push('A reading is outside the expected specification range');
  if (hasUnclear) reasons.push('Evidence image is unclear or insufficient to verify');
  if (hasContentUnverified) reasons.push('Required photo evidence was never content-verified (no AI check ran) — confirm manually before relying on it');
  if (typeof task.latest_score === 'number' && task.latest_score < LOW_SCORE_THRESHOLD) {
    reasons.push(`Unusually low evidence score (${task.latest_score}/100)`);
  }
  if (task.latest_decision === 'INSUFFICIENT_EVIDENCE') {
    reasons.push('No reference documentation found to confirm this reading is within spec');
  }
  // Only attach the "repeated pattern" reason to a job that is ITSELF part
  // of the pattern (non-verified) — a clean VERIFIED job by a technician who
  // also has unrelated problem jobs elsewhere is not, on its own, suspicious.
  if (task.latest_decision !== 'VERIFIED' && repeatedByTechnician && repeatedByTechnician >= REPEATED_ISSUE_THRESHOLD) {
    reasons.push(`${task.technician || 'This technician'} has ${repeatedByTechnician} non-verified jobs in this period — pattern worth reviewing`);
  }
  return reasons;
}

function buildSummary(from, to) {
  const tasks = tasksInRange(from, to);

  const byDecisionKey = {
    VERIFIED: 'verified',
    NEED_MORE_EVIDENCE: 'need_more_evidence',
    IMAGE_UNCLEAR: 'image_unclear',
    INSUFFICIENT_IMAGE_EVIDENCE: 'insufficient_image_evidence',
    CONFLICT_HUMAN_REVIEW: 'conflict',
    INSUFFICIENT_EVIDENCE: 'insufficient_evidence',
  };
  const byDecision = {
    verified: 0,
    need_more_evidence: 0,
    image_unclear: 0,
    insufficient_image_evidence: 0,
    conflict: 0,
    insufficient_evidence: 0,
    pending: 0,
  };
  let outOfRangeCount = 0;
  let scoredCount = 0;
  let scoreSum = 0;

  // Non-verified count per technician, for the "repeated issues" signal —
  // computed once over the whole range rather than per-task.
  const nonVerifiedByTechnician = new Map();

  for (const t of tasks) {
    const key = byDecisionKey[t.latest_decision];
    if (key) byDecision[key] += 1;
    else byDecision.pending += 1;

    if (classifyFields(t.latest_fields_json).hasOutOfRange) outOfRangeCount += 1;

    if (typeof t.latest_score === 'number') {
      scoredCount += 1;
      scoreSum += t.latest_score;
    }

    if (t.latest_decision && t.latest_decision !== 'VERIFIED') {
      const tech = t.technician || '(unassigned)';
      nonVerifiedByTechnician.set(tech, (nonVerifiedByTechnician.get(tech) || 0) + 1);
    }
  }

  const suspiciousJobs = [];
  for (const t of tasks) {
    if (!t.latest_decision) continue; // never verified at all yet — not "suspicious", just not attempted
    const repeated = nonVerifiedByTechnician.get(t.technician || '(unassigned)') || 0;
    const reasons = suspiciousReasons(t, repeated);
    if (reasons.length > 0) {
      suspiciousJobs.push({
        task_id: t.id,
        unit_id: t.unit_id,
        task_type: t.task_type,
        technician: t.technician,
        decision: t.latest_decision,
        evidence_score: t.latest_score,
        reasons,
        created_at: t.created_at,
      });
    }
  }

  return {
    range: { from, to },
    total_jobs: tasks.length,
    by_decision: byDecision,
    out_of_range_jobs: outOfRangeCount,
    average_evidence_score: scoredCount > 0 ? Math.round(scoreSum / scoredCount) : null,
    suspicious_count: suspiciousJobs.length,
    suspicious_jobs: suspiciousJobs,
  };
}

// GET /api/v1/reports/summary?date=YYYY-MM-DD             (daily)
// GET /api/v1/reports/summary?from=YYYY-MM-DD&to=YYYY-MM-DD (custom range)
// Defaults to today when nothing is passed.
router.get('/summary', (req, res) => {
  const { from, to } = parseDateRange(req.query);
  res.json(buildSummary(from, to));
});

function csvEscape(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// GET /api/v1/reports/export.csv?date=&from=&to=
router.get('/export.csv', (req, res) => {
  const { from, to } = parseDateRange(req.query);
  const tasks = tasksInRange(from, to);

  const columns = [
    'Date', 'Technician', 'Job Type', 'Defect', 'Machine ID', 'Machine Model',
    'Claim', 'Observed Value', 'Expected Range', 'Verification State', 'Evidence Score', 'Suspicious Flag',
  ];
  const rows = [columns.join(',')];

  for (const t of tasks) {
    const claimRow = db.prepare('SELECT raw_text FROM claims WHERE task_id = ? ORDER BY created_at DESC LIMIT 1').get(t.id);
    let observedSummary = '';
    let expectedRangeSummary = '';
    if (t.latest_fields_json) {
      try {
        const fields = JSON.parse(t.latest_fields_json);
        const checklist = getChecklistForTaskType(t.task_type);
        const numeric = fields.filter((f) => f.type === 'number' && f.sources && f.sources.length > 0);
        observedSummary = numeric.map((f) => `${f.key}=${f.sources[f.sources.length - 1]?.value ?? f.sources[0]?.value}`).join('; ');
        expectedRangeSummary = numeric
          .map((f) => {
            const spec = checklist.find((c) => c.key === f.key);
            return spec?.tolerance ? `${f.key}: ${spec.tolerance.min}-${spec.tolerance.max}${spec.unit || ''}` : f.key;
          })
          .join('; ');
      } catch {
        // malformed fields_json on an old row, or an unrecognized task_type — leave blank rather than fail the whole export
      }
    }
    const { hasMismatch, hasOutOfRange, hasUnclear, hasContentUnverified } = classifyFields(t.latest_fields_json);
    const suspicious =
      hasMismatch || hasOutOfRange || hasUnclear || hasContentUnverified || (typeof t.latest_score === 'number' && t.latest_score < LOW_SCORE_THRESHOLD);

    rows.push(
      [
        t.created_at,
        t.technician,
        t.task_type,
        t.defect,
        t.unit_id,
        t.machine_model,
        claimRow?.raw_text,
        observedSummary,
        expectedRangeSummary,
        t.latest_decision || 'pending',
        t.latest_score,
        suspicious ? 'yes' : 'no',
      ]
        .map(csvEscape)
        .join(',')
    );
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="realitycheck-report-${from}-to-${to}.csv"`);
  res.send(rows.join('\n'));
});

export default router;
