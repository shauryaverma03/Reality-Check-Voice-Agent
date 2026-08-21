// The verifier. Hand-rolled, no agent framework — this is the whole control
// flow, and it's meant to be readable top to bottom by a judge.
//
// Input:
//   checklist — array of field defs (see checklists.js)
//   claim     — { data: { [fieldKey]: value, ... } } | null   (the voice claim, one source)
//   evidence  — [ { role: string, data?: { [fieldKey]: value } }, ... ]
//               `role` identifies what the evidence item IS (e.g. "serial_photo",
//               "final_photo") and satisfies 'photo' fields whose key matches it.
//               `data` is whatever structured values were extracted FROM that
//               item (e.g. OCR off a nameplate, a gauge reading read off a
//               photo) and can independently satisfy 'id'/'number'/'text' fields.
//
// Output:
//   {
//     decision: 'VERIFIED' | 'NEED_MORE_EVIDENCE' | 'CONFLICT_HUMAN_REVIEW',
//     evidence_score: 0-100,
//     follow_up_question: string | null,
//     fields: [ { key, type, status, sources, message }, ... ]
//   }
//
// field.status is one of: 'ok' | 'borderline' | 'missing' | 'contradiction' | 'out_of_range'
//
// field.type 'document' behaves exactly like 'photo' here: both are
// evidence-presence checks satisfied by an evidence item whose `role`
// matches the field key. 'document' is for technician-submitted paperwork
// (job card, invoice) — never for reference manuals, which are a separate
// RAG-retrieved concept layered on top of this verifier, not a field type.

const CONTRADICTION_FRACTION = 0.2; // of tolerance-range width — numeric disagreement beyond this = contradiction
const BORDERLINE_FRACTION = 0.08; // of tolerance-range width — distance from an edge that counts as "borderline"

const SCORE_PENALTY = {
  contradiction: 15,
  out_of_range: 20,
  borderline: 5,
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

/** Gather every source that reports a value for this field key. */
function collectSources(field, claim, evidence) {
  const sources = [];
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

/** Shared by 'photo' and 'document' fields: both are satisfied purely by the
 * presence of an evidence item whose `role` matches the field key. */
function evaluateEvidencePresenceField(field, evidence) {
  const present = evidence.some((item) => item.role === field.key);
  if (!present) {
    return field.required
      ? { key: field.key, type: field.type, status: 'missing', sources: [], message: `Missing required evidence ${field.type === 'document' ? 'document' : 'photo'}: ${field.label}` }
      : { key: field.key, type: field.type, status: 'ok', sources: [], message: null };
  }
  return { key: field.key, type: field.type, status: 'ok', sources: [{ origin: field.key, value: true }], message: null };
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
    return {
      key: field.key,
      type: field.type,
      status: 'contradiction',
      sources: normalized,
      message: `Conflicting values for ${field.label}: ${summary}`,
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
    return {
      key: field.key,
      type: field.type,
      status: 'contradiction',
      sources: parsed,
      message: `Conflicting readings for ${field.label}: ${summary} (spread ${spread.toFixed(2)}${field.unit || ''} exceeds the ${contradictionThreshold.toFixed(2)}${field.unit || ''} measurement-noise allowance)`,
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

function evaluateField(field, claim, evidence) {
  if (field.type === 'photo' || field.type === 'document') {
    return evaluateEvidencePresenceField(field, evidence);
  }
  const sources = collectSources(field, claim, evidence);
  if (field.type === 'number') {
    return evaluateNumberField(field, sources);
  }
  // 'id' and 'text' both use normalized cross-source equality.
  return evaluateIdOrTextField(field, sources);
}

/**
 * Run the verifier over one task's claim + evidence against a checklist.
 */
export function verifyTask({ checklist, claim = null, evidence = [] }) {
  const fields = checklist.map((field) => evaluateField(field, claim, evidence));

  const badFields = fields.filter((f) => f.status === 'contradiction' || f.status === 'out_of_range');
  const missingFields = fields.filter((f) => f.status === 'missing');
  const borderlineFields = fields.filter((f) => f.status === 'borderline');

  let decision;
  let followUpQuestion = null;

  if (badFields.length > 0) {
    decision = 'CONFLICT_HUMAN_REVIEW';
  } else if (missingFields.length > 0) {
    decision = 'NEED_MORE_EVIDENCE';
    // Ask about the first missing field, in checklist order.
    const firstMissingKey = checklist.find((f) => missingFields.some((m) => m.key === f.key));
    followUpQuestion = buildFollowUpQuestion(firstMissingKey);
  } else {
    decision = 'VERIFIED';
  }

  const requiredFields = checklist.filter((f) => f.required);
  const matchedRequired = requiredFields.filter((f) => {
    const result = fields.find((r) => r.key === f.key);
    return result.status === 'ok' || result.status === 'borderline';
  });

  let score = requiredFields.length === 0 ? 100 : (matchedRequired.length / requiredFields.length) * 100;
  for (const f of fields) {
    if (f.status in SCORE_PENALTY) score -= SCORE_PENALTY[f.status];
  }
  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    decision,
    evidence_score: score,
    follow_up_question: followUpQuestion,
    fields,
  };
}
