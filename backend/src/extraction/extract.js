// Extraction layer: voice claim text -> structured fields, photo -> structured
// fields. This is the one file to touch to swap in real STT / a dedicated
// vision model later — everything else talks to this module's two exports,
// never to Claude directly.
//
// If ANTHROPIC_API_KEY is set, both extractors call the Claude API (one text
// call, one vision call), with a prompt BUILT FROM THE TASK'S CHECKLIST — so
// adding a new service type never requires touching this file. If it's
// unset, or the call throws/returns garbage, they degrade gracefully to a
// fallback so the pipeline still runs end-to-end without a key:
//   - claim text  -> a small regex/heuristic parser (checklist-driven, with
//                    hand-tuned patterns preserved for the original AC keys)
//   - photo       -> no OCR without a vision model, so field values still
//                    aren't extracted; but a deterministic, dependency-free
//                    structural check (imageQuality.js: file size + pixel
//                    dimensions) still runs, so an implausibly tiny or
//                    low-resolution upload is honestly flagged rather than
//                    silently accepted as valid evidence
//
// Never invents a manufacturer spec or a reference range here — that's the
// job of rag/retrieve.js, and it stays strictly separate from this module.

import Anthropic from '@anthropic-ai/sdk';
import { heuristicImageQuality } from './imageQuality.js';

const MODEL = 'claude-sonnet-5';

let cachedClient;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!cachedClient) cachedClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return cachedClient;
}

function parseJSONFromText(text) {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Heuristic fallback for the voice claim (no API key / API failure)
// ---------------------------------------------------------------------------

// Hand-tuned patterns for the original three AC keys, kept byte-for-byte
// identical to the pre-multi-service behavior so the AC demo never regresses
// — except the ID capture group itself, widened below (see ID_CAPTURE).
//
// ID_CAPTURE allows up to 4 leading letters before the digits, not just one:
// the original `[a-zA-Z]?\d+[a-zA-Z]?` could only ever match a single-letter
// prefix, so a real-world ID like "RO-2048" or "AC-1024" (2-letter service
// prefix, the format every service in this project actually uses) silently
// failed to match at all — the exact root cause of a reported bug where a
// technician's claim clearly named the machine but extraction still
// produced nothing, making the field look never-provided. `[-\s]?` also
// tolerates the hyphen or space a real ID often carries between the prefix
// and the number ("RO-2048", "RO 2048"), not just digits butted directly
// against a single letter.
const ID_CAPTURE = '([a-zA-Z]{0,4}[-\\s]?\\d+[a-zA-Z]?)';
const KNOWN_ID_PATTERNS = {
  machine_id: new RegExp(`\\b(?:machine|unit)\\s*(?:id\\s*|no\\.?\\s*|number\\s*)?[:#]?\\s*${ID_CAPTURE}`, 'i'),
};

// Secondary fallback when there's no "machine"/"unit" trigger word at all —
// a technician often just leads with the unit's own ID ("RO-2048 filter
// replaced...", "AC-1024 pressure is..."). Scoped to the very start of the
// claim specifically to avoid matching an unrelated alphanumeric token
// later in the sentence (a reading, a ppm value, etc.) as if it were an ID.
const LEADING_BARE_ID_PATTERN = /^\s*([A-Za-z]{1,4}-?\d{2,6})\b/;

const KNOWN_NUMBER_PATTERNS = {
  pressure: /pressure[^0-9-]*(-?\d+(?:\.\d+)?)/i,
  temperature: /temp(?:erature)?[^0-9-]*(-?\d+(?:\.\d+)?)/i,
};

/**
 * Generic fallback pattern for a numeric field the app doesn't have a
 * hand-tuned regex for: trigger on ANY individual word of the field's key
 * (not the whole key glued together) followed by a number. A key like
 * 'internal_temperature' has to match a technician just saying "temperature
 * is 8" — requiring the literal word "internal" too would never fire on
 * real speech. Short words (<3 chars) are excluded from being a trigger on
 * their own to keep false-positive risk down. Best-effort only — if nothing
 * matches, the field simply comes back missing (honest NEED_MORE_EVIDENCE,
 * never a guessed value).
 */
function genericNumberPattern(field) {
  const words = field.key.split('_').map(escapeRegExp).filter((w) => w.length >= 3);
  const trigger = words.length > 0 ? `(?:${words.join('|')})` : escapeRegExp(field.key);
  return new RegExp(`${trigger}[^0-9-]*(-?\\d+(?:\\.\\d+)?)`, 'i');
}

function genericIdPattern(field) {
  const trigger = escapeRegExp(field.key).replace(/_/g, '[\\s_]*');
  return new RegExp(`${trigger}\\s*(?:id\\s*|no\\.?\\s*|number\\s*)?[:#]?\\s*${ID_CAPTURE}`, 'i');
}

// ---------------------------------------------------------------------------
// Heuristic fallback for 'text' checklist fields (filter_replaced,
// cooling_verified, drainage_check, vibration_check, ...) — a completion/
// status statement, not free descriptive prose. Every one of these fields
// across every service checklist follows the same shape: "<subject> was
// <done/not done>" — so instead of a per-service lookup table, the trigger
// word is derived generically from the field's own key (filter_replaced ->
// "filter", cooling_verified -> "cooling", drainage_check -> "drainage",
// vibration_check -> "vibration"), and the same completion/negation
// detector runs for all of them.
// ---------------------------------------------------------------------------

// Suffixes that describe HOW a field is checked, not WHAT it's about —
// stripped so the remaining word(s) are the actual subject to search for in
// the claim text.
const TEXT_FIELD_STOP_SUFFIXES = new Set(['check', 'checked', 'verified', 'replaced', 'status', 'result', 'test', 'tested']);

// A checklist key uses its noun form ("drainage_check", "vibration_check")
// but real speech uses whatever conjugation is natural ("drain test",
// "vibrating"). Stripping a trailing noun-forming suffix turns the trigger
// into a shared root ("drainage" -> "drain", "vibration" -> "vibr") that a
// `\bROOT\w*` match then catches regardless of conjugation — checked
// longest-suffix-first so "vibration" strips as "-ation" (-> "vibr") before
// the shorter "-ion" would (-> "vibrat").
const SUFFIX_STRIP = ['ation', 'ing', 'age', 'ion', 'ed'];
function stemWord(word) {
  for (const suffix of SUFFIX_STRIP) {
    if (word.length > suffix.length + 3 && word.endsWith(suffix)) return word.slice(0, -suffix.length);
  }
  return word;
}

function textFieldTriggerWords(field) {
  const meaningful = field.key.split('_').filter((w) => w.length >= 3 && !TEXT_FIELD_STOP_SUFFIXES.has(w));
  const words = meaningful.length > 0 ? meaningful : field.key.split('_').filter((w) => w.length >= 3);
  return words.map(stemWord);
}

// Word stems, not exact words, so "replace/replaced/replacing/replacement"
// or "verify/verified/verifying" all match the same cue — a real claim is
// spoken/transcribed text, not a fixed vocabulary list.
const POSITIVE_COMPLETION_CUES = /\b(replac\w*|install\w*|complet\w*|fix\w*|resolv\w*|normal\w*|ok(?:ay)?\w*|fine|pass\w*|clear\w*|clean\w*|verif\w*|confirm\w*|work(?:ed|ing)?|good|done|addressed|resolved)\b/i;
const NEGATION_CUES = /\b(not|never|n't|without|no|fail\w*|didn't|isn't|wasn't|hasn't)\b/i;
// How far a negation cue can sit before a completion cue and still be read
// as negating it ("filter was NOT replaced") rather than an unrelated
// negation elsewhere in the same sentence.
const NEGATION_PROXIMITY_CHARS = 30;

/**
 * @param {string} rawText
 * @param {object} field — a 'text'-type checklist field
 * @returns {boolean|undefined} true/false if a completion statement about
 *   this field's subject was found (negation-aware); undefined if nothing
 *   relevant was said — never a guess.
 */
function heuristicExtractTextField(rawText, field) {
  const triggers = textFieldTriggerWords(field);
  if (triggers.length === 0) return undefined;

  // Scope the search to sentences that actually mention the subject — a
  // negation elsewhere in a long claim (about a different field entirely)
  // must never flip this field's value.
  const triggerPattern = new RegExp(`\\b(?:${triggers.map(escapeRegExp).join('|')})\\w*`, 'i');
  const sentences = rawText.split(/(?<=[.!?])\s+/).filter((s) => triggerPattern.test(s));
  if (sentences.length === 0) return undefined;
  const scoped = sentences.join(' ');

  const positiveMatch = POSITIVE_COMPLETION_CUES.exec(scoped);
  if (!positiveMatch) return undefined;

  // Look for a negation cue anywhere before the completion cue, within the
  // proximity window — "filter was NOT replaced" negates; "filter replaced,
  // not damaged" does not (the negation comes AFTER the relevant cue, about
  // something else).
  const beforeCue = scoped.slice(0, positiveMatch.index);
  const windowStart = Math.max(0, positiveMatch.index - NEGATION_PROXIMITY_CHARS);
  const negationMatch = NEGATION_CUES.exec(beforeCue.slice(windowStart));
  return !negationMatch;
}

/**
 * @param {string} rawText
 * @param {Array} checklist — fields to attempt to extract: 'id' and
 *   'number' types via regex value-extraction, 'text' types via the
 *   completion/negation detector above. Free-text fields with no
 *   recognizable completion-statement shape are left for the technician to
 *   confirm explicitly rather than guessed at.
 */
function heuristicExtractClaim(rawText, checklist) {
  const data = {};
  for (const field of checklist) {
    if (field.type === 'id') {
      const pattern = KNOWN_ID_PATTERNS[field.key] || genericIdPattern(field);
      const match = rawText.match(pattern) || rawText.match(LEADING_BARE_ID_PATTERN);
      if (match) data[field.key] = match[1];
    } else if (field.type === 'number') {
      const pattern = KNOWN_NUMBER_PATTERNS[field.key] || genericNumberPattern(field);
      const match = rawText.match(pattern);
      if (match) data[field.key] = Number.parseFloat(match[1]);
    } else if (field.type === 'text') {
      const extracted = heuristicExtractTextField(rawText, field);
      if (extracted !== undefined) data[field.key] = extracted;
    }
  }
  return data;
}

function buildClaimSystemPrompt(checklist) {
  const lines = checklist
    .filter((f) => f.type === 'id' || f.type === 'number' || f.type === 'text')
    .map((f) => {
      if (f.type === 'number') return `- "${f.key}": number — ${f.label}${f.unit ? ` in ${f.unit}` : ''}`;
      if (f.type === 'id') return `- "${f.key}": string — the ${f.label.toLowerCase()}`;
      return `- "${f.key}": string — ${f.label}`;
    });
  return `You extract structured maintenance-job facts from a field technician's spoken claim (transcribed speech, which may mix Hindi and English). Respond with ONLY a JSON object — no prose, no markdown code fences. Include a key only if you are confident it was actually stated; never invent a value. Possible keys:\n${lines.join('\n')}`;
}

/**
 * @param {{ rawText: string, checklist: Array }} input
 * @returns {Promise<{ data: object, source: 'claude' | 'heuristic' }>}
 */
export async function extractClaimFromVoice({ rawText, checklist }) {
  const anthropic = getClient();
  if (!anthropic) {
    return { data: heuristicExtractClaim(rawText, checklist), source: 'heuristic' };
  }
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 300,
      system: buildClaimSystemPrompt(checklist),
      messages: [{ role: 'user', content: rawText }],
    });
    const textBlock = response.content?.find((b) => b.type === 'text');
    const parsed = parseJSONFromText(textBlock?.text);
    if (!parsed) throw new Error('Claude returned no parseable JSON for claim extraction');
    return { data: parsed, source: 'claude' };
  } catch (err) {
    console.error('[extraction] Claude claim extraction failed, falling back to heuristic parser:', err.message);
    return { data: heuristicExtractClaim(rawText, checklist), source: 'heuristic' };
  }
}

// ---------------------------------------------------------------------------
// Photo extraction
// ---------------------------------------------------------------------------

// Only these are legitimate quality_issue values — anything else Claude
// returns (or misspells) is treated the same as "readable: false, issue
// unspecified" rather than silently accepted as a new, uncontrolled value
// that the UI/verifier don't know how to render.
const KNOWN_QUALITY_ISSUES = new Set([
  'blurry',
  'dark',
  'overexposed',
  'low_resolution',
  'wrong_subject',
  'insufficient_detail',
]);

// What this photo's role SHOULD show, per service — used to build an
// explicit "does the equipment in this photo match the job" instruction.
// Keyed by task_type since that's what routes/evidence.js already has on
// hand (the task row) without any new lookup.
const SERVICE_EQUIPMENT_LABEL = {
  'ac-service': 'a split or window air conditioner (indoor/outdoor unit, nameplate, or a gauge/thermometer reading)',
  'ro-service': 'an RO / water purifier (its housing, nameplate, or a replaced filter cartridge)',
  'fridge-service': 'a refrigerator (its cabinet, nameplate, or an interior/thermometer reading)',
  'washer-service': 'a washing machine (its housing, nameplate, or its control panel/error display)',
};

function buildPhotoSystemPrompt(checklist, role, taskType) {
  const lines = checklist
    .filter((f) => f.type === 'id' || f.type === 'number')
    .map((f) =>
      f.type === 'number'
        ? `- "${f.key}": number — a ${f.label.toLowerCase()} reading${f.unit ? ` in ${f.unit}` : ''}, if visible`
        : `- "${f.key}": string — a printed ${f.label.toLowerCase()}, if visible`
    );
  const expectedEquipment = SERVICE_EQUIPMENT_LABEL[taskType];
  const subjectCheck = expectedEquipment
    ? `\n\nThis job is for ${expectedEquipment}. Before anything else, check whether the photo actually shows equipment consistent with that — a photo of a completely different type of appliance (e.g. an air conditioner uploaded for a washing-machine job) is NOT valid evidence for this job, no matter how clear the photo is. If the equipment shown clearly does NOT match, set "readable": false and "quality_issue": "wrong_subject" — do not extract any fields from it.`
    : '';
  return `You read structured facts off a photo submitted as job evidence by a field technician (this one is tagged "${role}"). Respond with ONLY a JSON object — no prose, no markdown code fences.

First assess whether the photo is actually usable as evidence:
- "readable": true or false — false if the photo is blurry, extremely low resolution, unreadably dark/overexposed, or doesn't show enough of the relevant equipment/readout to check anything against.
- "quality_issue": one of "blurry" | "dark" | "overexposed" | "low_resolution" | "wrong_subject" | "insufficient_detail", or null if readable is true.${subjectCheck}

Then, ONLY if actually legible AND showing the right equipment, extract these fields (include a key only if you can confidently read it — never invent or guess a value):
${lines.join('\n')}

Respond with a single flat JSON object containing "readable", "quality_issue", and any of the extracted keys above that are legible.`;
}

/**
 * @param {{ buffer: Buffer, mimeType: string, role: string, checklist: Array, taskType?: string }} input
 *   `taskType` (e.g. "ro-service") is optional but strongly recommended —
 *   without it, the vision call can still judge blur/exposure/resolution
 *   but has no basis to catch a photo of the wrong equipment entirely
 *   (e.g. an AC unit uploaded against an RO job's required evidence).
 * @returns {Promise<{ data: object, source: 'claude' | 'none', quality: { readable: boolean, issue: string|null, note: string } }>}
 */
export async function extractEvidenceFromPhoto({ buffer, mimeType, role, checklist, taskType }) {
  const anthropic = getClient();
  if (!anthropic) {
    // No vision model to judge readability OR subject with — fall back to a
    // deterministic, dependency-free structural check (file size / pixel
    // dimensions). Field-value OCR still isn't attempted without AI (no
    // guessing), and — critically — a structurally-fine file is NOT the
    // same as a content-verified one: the caller (verifier.js) gates on
    // `source` for exactly this reason, so this heuristic path can never by
    // itself produce VERIFIED for a required photo field.
    return { data: {}, source: 'none', quality: heuristicImageQuality(buffer, mimeType) };
  }
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 300,
      system: buildPhotoSystemPrompt(checklist, role, taskType),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType, data: buffer.toString('base64') } },
            { type: 'text', text: `This photo is tagged as: ${role}.` },
          ],
        },
      ],
    });
    const textBlock = response.content?.find((b) => b.type === 'text');
    const parsed = parseJSONFromText(textBlock?.text);
    if (!parsed) throw new Error('Claude returned no parseable JSON for photo extraction');

    const { readable, quality_issue, ...data } = parsed;
    const issue = KNOWN_QUALITY_ISSUES.has(quality_issue) ? quality_issue : readable === false ? 'insufficient_detail' : null;
    const quality = {
      readable: readable !== false, // default to true only if the model didn't explicitly flag it — never assume unusable on a missing field
      issue,
      note: issue ? `Vision model flagged this photo as unusable: ${issue.replace(/_/g, ' ')}.` : 'Assessed as readable by the vision model.',
    };
    return { data, source: 'claude', quality };
  } catch (err) {
    console.error('[extraction] Claude photo extraction failed, degrading to heuristic quality check:', err.message);
    return { data: {}, source: 'none', quality: heuristicImageQuality(buffer, mimeType) };
  }
}
