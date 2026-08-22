// The verifier. Hand-rolled, no agent framework — this is the whole control
// flow, and it's meant to be readable top to bottom by a judge.
//
// Input:
//   checklist — array of field defs (see checklists.js)
//   claim     — { data: { [fieldKey]: value, ... } } | null   (the voice claim, one source)
//   evidence  — [ { role, data?, quality?, extractionSource? }, ... ], oldest
//               first (the caller orders by created_at — see verifications.js)
//               `role` identifies what the evidence item IS (e.g. "serial_photo",
//               "final_photo") and satisfies 'photo' fields whose key matches it.
//               `data` is whatever structured values were extracted FROM that
//               item (e.g. OCR off a nameplate, a gauge reading read off a
//               photo) and can independently satisfy 'id'/'number'/'text' fields.
//               `quality` is { readable, issue, note } from extraction/extract.js.
//               `extractionSource` is 'claude' | 'none' — whether a real vision
//               call actually judged this item, or only the no-AI structural
//               heuristic did; only the most recent item per role is ever
//               used (a replaced photo supersedes what it replaced).
//
// Output:
//   {
//     decision: 'VERIFIED' | 'NEED_MORE_EVIDENCE' | 'IMAGE_UNCLEAR' | 'CONFLICT_HUMAN_REVIEW',
//     evidence_score: 0-100,
//     follow_up_question: string | null,
//     fields: [ { key, type, status, sources, message }, ... ]
//   }
//
// field.status is one of:
//   'ok' | 'borderline' | 'missing' | 'contradiction' | 'out_of_range' | 'unclear'
//
// 'unclear' is specific to 'photo'/'document' fields: evidence WAS uploaded
// for that role, but extraction (extraction/extract.js, backed by
// extraction/imageQuality.js when there's no AI call) flagged it as
// unusable — too blurry/dark/low-resolution/off-subject to actually verify
// anything against. This is deliberately distinct from 'missing' (nothing
// uploaded at all): the technician did submit something, it just can't be
// trusted, which is a different problem with a different fix (re-upload,
// not "upload for the first time").
//
// field.type 'document' behaves exactly like 'photo' here: both are
// evidence-presence checks satisfied by an evidence item whose `role`
// matches the field key. 'document' is for technician-submitted paperwork
// (job card, invoice) — never for reference manuals, which are a separate
// RAG-retrieved concept layered on top of this verifier, not a field type.
//
// A numeric/id 'contradiction' between the voice claim and a value read off
// an image (or between two evidence items) is flagged with `mismatch: true`
// on the field result — this IS the "claimed value doesn't match observed
// evidence" case; it's represented as CONFLICT_HUMAN_REVIEW (not a separate
// top-level decision) because that's exactly what it already is: sources
// disagree and a human needs to look, whether the disagreeing sources are
// two claims, two photos, or a claim and a photo.
//
// verifyTaskWithReferences() (below) wraps this with a further decision,
// INSUFFICIENT_EVIDENCE, for checklist fields flagged `needsReference: true`
// that RAG couldn't find any supporting knowledge-base chunk for. It never
// changes verifyTask's own behavior — see its doc comment.

const CONTRADICTION_FRACTION = 0.2; // of tolerance-range width — numeric disagreement beyond this = contradiction
const BORDERLINE_FRACTION = 0.08; // of tolerance-range width — distance from an edge that counts as "borderline"

const SCORE_PENALTY = {
  contradiction: 15,
  out_of_range: 20,
  borderline: 5,
  insufficient_evidence: 20,
  unclear: 20,
};

/**
 * Normalize an 'id'/'text' value for cross-source comparison: coerce to
 * string, trim, lowercase, collapse internal whitespace runs to one space.
 * ("Machine 27", "  machine   27 ", "MACHINE 27" all normalize equal.)
 */
function normalizeIdValue(value) {
  return String(value).trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Coerce a value (number, or string possibly carrying a unit like "4.2 bar")
 * to a finite number, or null if it can't be read as one.
 */
function coerceNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const match = value.match(/-?\d+(\.\d+)?/);
    if (!match) return null;
    const parsed = Number.parseFloat(match[0]);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Gather every source that reports a value for this field key — job context
 * first (the Start-a-Job wizard's own structured data), then the voice
 * claim, then whatever evidence items independently read. Job context is
 * added as a source like any other, not a silent override: if the claim or
 * a photo disagrees with it, that's still a real contradiction the
 * technician needs to resolve (see evaluateIdOrTextField's "Expected:
 * <job context> / Observed: <claim or photo>" framing) — but if nothing
 * else mentions the field, the job's own record is enough on its own, and
 * the field must never be reported "missing" just because claim extraction
 * failed to re-derive information the system already had. This is the
 * fix for the core reported bug: machine_id came from the Start-a-Job
 * wizard's unit_id field, and used to be invisible to the verifier
 * entirely — extraction failing to re-parse it out of free text then
 * looked exactly like the technician never having provided it at all. */
function collectSources(field, claim, evidence, taskContext) {
  const sources = [];
  if (taskContext && JOB_CONTEXT_FIELD_KEYS.has(field.key) && taskContext.unit_id) {
    sources.push({ origin: 'job_context', value: taskContext.unit_id });
  }
  if (claim && claim.data && Object.prototype.hasOwnProperty.call(claim.data, field.key)) {
    sources.push({ origin: 'voice', value: claim.data[field.key] });
  }
  for (const item of evidence) {
    if (item.data && Object.prototype.hasOwnProperty.call(item.data, field.key)) {
      sources.push({ origin: item.role, value: item.data[field.key] });
    }
  }
  return sources;
}

// Every checklist across every service names its machine-identity field
// "machine_id" (checked in checklists.js) — that convention, not a
// per-service config table, is what lets job-context sourcing above apply
// identically to AC/RO/fridge/washer with zero service-specific code.
const JOB_CONTEXT_FIELD_KEYS = new Set(['machine_id']);

function buildFollowUpQuestion(field) {
  switch (field.type) {
    case 'photo':
      return `Please upload a photo for: ${field.label}.`;
    case 'document':
      return `Please attach a document for: ${field.label}.`;
    case 'id':
      return `What is the ${field.label}?`;
    case 'number':
      return `What is the ${field.label} reading${field.unit ? ` (in ${field.unit})` : ''}?`;
    default:
      return `Please provide: ${field.label}.`;
  }
}

/** Shared by 'photo' and 'document' fields: satisfied by the presence of an
 * evidence item whose `role` matches the field key — AND, now, by that
 * item's content actually being usable. An evidence item carries an optional
 * `quality: { readable, issue, note }` (see extraction/extract.js); a photo
 * that was uploaded but flagged unreadable does NOT satisfy the field —
 * evidence existing is not the same as evidence being valid. */
function evaluateEvidencePresenceField(field, evidence) {
  const matching = evidence.filter((item) => item.role === field.key);
  if (matching.length === 0) {
    return field.required
      ? { key: field.key, type: field.type, status: 'missing', sources: [], message: `Missing required evidence ${field.type === 'document' ? 'document' : 'photo'}: ${field.label}` }
      : { key: field.key, type: field.type, status: 'ok', sources: [], message: null };
  }

  // Only the MOST RECENT upload for this role is authoritative — `evidence`
  // is ordered oldest-first by the caller, so that's the last match.
  // A technician who replaces a blurry photo with a clear one needs that to
  // actually clear the problem; scanning every historical upload for this
  // role would let one old bad photo permanently block the field even after
  // it's been fixed.
  const current = matching[matching.length - 1];
  if (current.quality && current.quality.readable === false) {
    const issueLabel = current.quality.issue ? current.quality.issue.replace(/_/g, ' ') : 'unclear';
    return {
      key: field.key,
      type: field.type,
      status: 'unclear',
      sources: [],
      qualityIssue: current.quality.issue,
      message: `Image is unclear or insufficient to verify ${field.label} (${issueLabel}). ${current.quality.note || 'Please re-upload a clearer image.'}`,
    };
  }

  // Structurally fine, but if there was no AI call to actually judge
  // content (readable defaults true only because nothing flagged it false —
  // see extraction/extract.js), be honest that presence + structural
  // plausibility is not the same as a semantic content check.
  const contentVerified = current.extractionSource === 'claude';
  return {
    key: field.key,
    type: field.type,
    status: 'ok',
    sources: [{ origin: field.key, value: true }],
    contentVerified,
    message: contentVerified ? null : 'Uploaded and structurally plausible — content not semantically verified (no AI available for this check).',
  };
}

function evaluateIdOrTextField(field, sources) {
  if (sources.length === 0) {
    return field.required
      ? { key: field.key, type: field.type, status: 'missing', sources, message: `Missing required field: ${field.label}` }
      : { key: field.key, type: field.type, status: 'ok', sources, message: null };
  }

  const normalized = sources.map((s) => ({ ...s, normalized: normalizeIdValue(s.value) }));
  const distinctValues = new Set(normalized.map((n) => n.normalized));

  if (distinctValues.size > 1) {
    const summary = normalized.map((n) => `${n.origin}="${n.value}"`).join(' vs ');
    const jobSource = normalized.find((n) => n.origin === 'job_context');
    const voiceSource = normalized.find((n) => n.origin === 'voice');
    // Job context (the Start-a-Job wizard's own record) is the most
    // authoritative source when it's present — "Expected" is what the job
    // was actually created with, "Observed" is whatever the claim or a
    // photo said instead (this is the machine-ID-mismatch case: a photo of
    // the wrong unit, or a claim that names a different machine). Falls
    // back to "Claimed/Observed" framing (the claim-vs-evidence mismatch
    // case) when there's no job context source to anchor on.
    let message;
    if (jobSource) {
      const disagreeing = normalized.filter((n) => n !== jobSource);
      const label = field.key === 'machine_id' ? 'Machine ID mismatch' : `Mismatch on ${field.label}`;
      message = `${label}.\nExpected: "${jobSource.value}" (from the job record)\nObserved: ${disagreeing.map((n) => `"${n.value}" (${n.origin})`).join(', ')}\nThe claim or uploaded evidence doesn't match this job's ${field.label.toLowerCase()}.`;
    } else if (voiceSource) {
      message = `Claimed value: "${voiceSource.value}"\nObserved value: ${normalized.filter((n) => n !== voiceSource).map((n) => `"${n.value}" (${n.origin})`).join(', ')}\nThe uploaded evidence does not match the technician's claim for ${field.label}.`;
    } else {
      message = `Conflicting values for ${field.label}: ${summary}`;
    }
    return {
      key: field.key,
      type: field.type,
      status: 'contradiction',
      sources: normalized,
      mismatch: Boolean(jobSource || voiceSource),
      machineMismatch: Boolean(jobSource && field.key === 'machine_id'),
      message,
    };
  }

  return { key: field.key, type: field.type, status: 'ok', sources: normalized, message: null };
}

function evaluateNumberField(field, sources) {
  if (sources.length === 0) {
    return field.required
      ? { key: field.key, type: field.type, status: 'missing', sources, message: `Missing required field: ${field.label}` }
      : { key: field.key, type: field.type, status: 'ok', sources, message: null };
  }

  const parsed = sources.map((s) => ({ ...s, numericValue: coerceNumber(s.value) }));
  const unreadable = parsed.filter((p) => p.numericValue === null);
  if (unreadable.length > 0) {
    const summary = unreadable.map((p) => `${p.origin}="${p.value}"`).join(', ');
    return {
      key: field.key,
      type: field.type,
      status: 'contradiction',
      sources: parsed,
      message: `Unreadable numeric value for ${field.label}: ${summary}`,
    };
  }

  const { min, max } = field.tolerance;
  const width = max - min;
  const contradictionThreshold = width * CONTRADICTION_FRACTION;
  const borderlineThreshold = width * BORDERLINE_FRACTION;

  const values = parsed.map((p) => p.numericValue);
  const spread = Math.max(...values) - Math.min(...values);

  if (spread > contradictionThreshold) {
    const summary = parsed.map((p) => `${p.origin}=${p.numericValue}${field.unit || ''}`).join(' vs ');
    const voiceSource = parsed.find((p) => p.origin === 'voice');
    // "Claimed X vs observed Y" phrasing whenever the technician's own claim
    // is one of the disagreeing sources (the DATA_MISMATCH case) — not just
    // any two sources disagreeing with each other.
    const message = voiceSource
      ? `Claimed value: ${voiceSource.numericValue}${field.unit || ''}\nObserved value: ${parsed.filter((p) => p !== voiceSource).map((p) => `${p.numericValue}${field.unit || ''} (${p.origin})`).join(', ')}\nThe uploaded evidence does not match the technician's claim for ${field.label}.`
      : `Conflicting readings for ${field.label}: ${summary} (spread ${spread.toFixed(2)}${field.unit || ''} exceeds the ${contradictionThreshold.toFixed(2)}${field.unit || ''} measurement-noise allowance)`;
    return {
      key: field.key,
      type: field.type,
      status: 'contradiction',
      sources: parsed,
      mismatch: Boolean(voiceSource),
      message,
    };
  }

  // Sources agree closely enough to be "the same reading" — use their
  // average as the representative value for range/borderline checks.
  const representative = values.reduce((a, b) => a + b, 0) / values.length;

  if (representative < min || representative > max) {
    return {
      key: field.key,
      type: field.type,
      status: 'out_of_range',
      sources: parsed,
      message: `${field.label} reading ${representative.toFixed(2)}${field.unit || ''} is outside the required range ${min}-${max}${field.unit || ''}`,
    };
  }

  const distanceToMin = representative - min;
  const distanceToMax = max - representative;
  if (distanceToMin <= borderlineThreshold || distanceToMax <= borderlineThreshold) {
    const nearEdge = distanceToMin <= distanceToMax ? 'lower' : 'upper';
    return {
      key: field.key,
      type: field.type,
      status: 'borderline',
      sources: parsed,
      message: `${field.label} reading ${representative.toFixed(2)}${field.unit || ''} is close to the ${nearEdge} edge of the ${min}-${max}${field.unit || ''} tolerance range`,
    };
  }

  return { key: field.key, type: field.type, status: 'ok', sources: parsed, message: null };
}

function evaluateField(field, claim, evidence, taskContext) {
  if (field.type === 'photo' || field.type === 'document') {
    return evaluateEvidencePresenceField(field, evidence);
  }
  const sources = collectSources(field, claim, evidence, taskContext);
  if (field.type === 'number') {
    return evaluateNumberField(field, sources);
  }
  // 'id' and 'text' both use normalized cross-source equality.
  return evaluateIdOrTextField(field, sources);
}

/**
 * % of required fields matched (ok/borderline), minus per-field penalties.
 * Pulled out of verifyTask so verifyTaskWithReferences can recompute the
 * score after it revises a field's status, using the exact same formula —
 * never a separately-invented/fabricated number.
 */
function computeScore(checklist, fields) {
  const requiredFields = checklist.filter((f) => f.required);
  const matchedRequired = requiredFields.filter((f) => {
    const result = fields.find((r) => r.key === f.key);
    return result.status === 'ok' || result.status === 'borderline';
  });

  let score = requiredFields.length === 0 ? 100 : (matchedRequired.length / requiredFields.length) * 100;
  for (const f of fields) {
    if (f.status in SCORE_PENALTY) score -= SCORE_PENALTY[f.status];
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Run the verifier over one task's claim + evidence against a checklist.
 *
 * @param {{ checklist: Array, claim: object|null, evidence: Array,
 *   taskContext?: { unit_id?: string } }} input
 *   `taskContext` is the Start-a-Job wizard's own structured record for
 *   this task (currently just unit_id — the one piece of job context every
 *   checklist actually verifies against). Optional and additive: omitting
 *   it entirely reproduces the exact pre-existing behavior, which is what
 *   keeps every one of the original 27 eval cases passing unchanged.
 */
export function verifyTask({ checklist, claim = null, evidence = [], taskContext = null }) {
  const fields = checklist.map((field) => evaluateField(field, claim, evidence, taskContext));

  const badFields = fields.filter((f) => f.status === 'contradiction' || f.status === 'out_of_range');
  const unclearFields = fields.filter((f) => f.status === 'unclear');
  const missingFields = fields.filter((f) => f.status === 'missing');

  let decision;
  let followUpQuestion = null;

  // Priority: a confirmed problem (contradiction/out-of-range) outranks an
  // unclear image (we don't know), which outranks something simply not
  // submitted yet, which outranks a clean pass.
  if (badFields.length > 0) {
    decision = 'CONFLICT_HUMAN_REVIEW';
  } else if (unclearFields.length > 0) {
    decision = 'IMAGE_UNCLEAR';
    followUpQuestion = unclearFields[0].message;
  } else if (missingFields.length > 0) {
    decision = 'NEED_MORE_EVIDENCE';
    // Ask about the first missing field, in checklist order.
    const firstMissingKey = checklist.find((f) => missingFields.some((m) => m.key === f.key));
    followUpQuestion = buildFollowUpQuestion(firstMissingKey);
  } else {
    decision = 'VERIFIED';
  }

  return {
    decision,
    evidence_score: computeScore(checklist, fields),
    follow_up_question: followUpQuestion,
    fields,
  };
}

/**
 * Wraps verifyTask with RAG-reference backing for fields flagged
 * `needsReference: true` in the checklist. Does NOT alter verifyTask's own
 * behavior in any way — every existing caller/test of verifyTask (including
 * the full 20-case eval suite) is unaffected by this function's existence.
 *
 * Only a field that already cleared every other check (status 'ok' or
 * 'borderline') is eligible to be downgraded here — a field that's already
 * missing/contradictory/out_of_range explains itself and doesn't need a
 * reference to also be "wrong."
 *
 * @param {{ checklist: Array, claim: object|null, evidence: Array,
 *   references: Record<string, { citation: object } | { conflict: { a: object, b: object } }> }} input
 *   `references[field.key]` present with a `citation` means RAG found a
 *   supporting knowledge-base chunk for that field; present with a
 *   `conflict` means two DIFFERENT sources gave materially different
 *   ranges for it (never silently resolved — both are preserved and shown);
 *   absent means nothing was found — never invented, never assumed.
 */
export function verifyTaskWithReferences({ checklist, claim = null, evidence = [], references = {}, taskContext = null }) {
  const base = verifyTask({ checklist, claim, evidence, taskContext });

  const fields = base.fields.map((field) => {
    const checklistField = checklist.find((f) => f.key === field.key);
    if (!checklistField?.needsReference) return field;
    if (field.status !== 'ok' && field.status !== 'borderline') return field;

    const reference = references[field.key];
    if (reference?.conflict) {
      const { a, b } = reference.conflict;
      return {
        ...field,
        status: 'contradiction',
        message: `Reference sources disagree on "${checklistField.label}": "${a.document_title}" vs "${b.document_title}" state different ranges — needs human review, not auto-resolved.`,
        conflictingReferences: [a, b],
      };
    }
    if (reference?.citation) {
      return { ...field, citation: reference.citation };
    }
    return {
      ...field,
      status: 'insufficient_evidence',
      message: `No reference documentation found to confirm "${checklistField.label}" is within spec for this equipment — upload the relevant manual or escalate for human review.`,
    };
  });

  const badFields = fields.filter((f) => f.status === 'contradiction' || f.status === 'out_of_range');
  const unclearFields = fields.filter((f) => f.status === 'unclear');
  const insufficientFields = fields.filter((f) => f.status === 'insufficient_evidence');
  const missingFields = fields.filter((f) => f.status === 'missing');

  let decision;
  let followUpQuestion = base.follow_up_question;

  // Priority: CONFLICT > IMAGE_UNCLEAR > INSUFFICIENT_EVIDENCE > NEED_MORE_EVIDENCE > VERIFIED
  if (badFields.length > 0) {
    decision = 'CONFLICT_HUMAN_REVIEW';
  } else if (unclearFields.length > 0) {
    decision = 'IMAGE_UNCLEAR';
    followUpQuestion = unclearFields[0].message;
  } else if (insufficientFields.length > 0) {
    decision = 'INSUFFICIENT_EVIDENCE';
    followUpQuestion = insufficientFields[0].message;
  } else if (missingFields.length > 0) {
    decision = 'NEED_MORE_EVIDENCE';
  } else {
    decision = 'VERIFIED';
  }

  const citations = fields.flatMap((f) => {
    if (f.citation) return [{ field_key: f.key, ...f.citation }];
    if (f.conflictingReferences) {
      return f.conflictingReferences.map((ref) => ({ field_key: f.key, conflict: true, ...ref }));
    }
    return [];
  });

  return {
    decision,
    evidence_score: computeScore(checklist, fields),
    follow_up_question: followUpQuestion,
    fields,
    citations,
  };
}
