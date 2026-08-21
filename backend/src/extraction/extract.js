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
//   - photo       -> presence-only (no OCR without a vision model); the
//                    verifier still treats the photo/document field as
//                    satisfied, it just can't cross-check numeric/id values
//
// Never invents a manufacturer spec or a reference range here — that's the
// job of rag/retrieve.js, and it stays strictly separate from this module.

import Anthropic from '@anthropic-ai/sdk';

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
// identical to the pre-multi-service behavior so the AC demo never regresses.
const KNOWN_ID_PATTERNS = {
  machine_id: /\b(?:machine|unit)\s*(?:id\s*|no\.?\s*|number\s*)?[:#]?\s*([a-zA-Z]?\d+[a-zA-Z]?)/i,
};

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
  return new RegExp(`${trigger}\\s*(?:id\\s*|no\\.?\\s*|number\\s*)?[:#]?\\s*([a-zA-Z]?\\d+[a-zA-Z]?)`, 'i');
}

/**
 * @param {string} rawText
 * @param {Array} checklist — fields to attempt to extract; only 'id' and
 *   'number' types are attempted (free-text fields aren't reliably
 *   regex-extractable, and are left for the technician to correct/confirm).
 */
function heuristicExtractClaim(rawText, checklist) {
  const data = {};
  for (const field of checklist) {
    if (field.type === 'id') {
      const pattern = KNOWN_ID_PATTERNS[field.key] || genericIdPattern(field);
      const match = rawText.match(pattern);
      if (match) data[field.key] = match[1];
    } else if (field.type === 'number') {
      const pattern = KNOWN_NUMBER_PATTERNS[field.key] || genericNumberPattern(field);
      const match = rawText.match(pattern);
      if (match) data[field.key] = Number.parseFloat(match[1]);
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

function buildPhotoSystemPrompt(checklist, role) {
  const lines = checklist
    .filter((f) => f.type === 'id' || f.type === 'number')
    .map((f) =>
      f.type === 'number'
        ? `- "${f.key}": number — a ${f.label.toLowerCase()} reading${f.unit ? ` in ${f.unit}` : ''}, if visible`
        : `- "${f.key}": string — a printed ${f.label.toLowerCase()}, if visible`
    );
  return `You read structured facts off a photo submitted as job evidence by a field technician (this one is tagged "${role}"). Respond with ONLY a JSON object — no prose, no markdown code fences. Include a key only if it is actually legible in the photo; never invent a value. Possible keys:\n${lines.join('\n')}`;
}

/**
 * @param {{ buffer: Buffer, mimeType: string, role: string, checklist: Array }} input
 * @returns {Promise<{ data: object, source: 'claude' | 'none' }>}
 */
export async function extractEvidenceFromPhoto({ buffer, mimeType, role, checklist }) {
  const anthropic = getClient();
  if (!anthropic) {
    // No OCR without a vision model — degrade to presence-only. The verifier
    // still treats this evidence item as satisfying the photo/document field.
    return { data: {}, source: 'none' };
  }
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 300,
      system: buildPhotoSystemPrompt(checklist, role),
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
    return { data: parsed, source: 'claude' };
  } catch (err) {
    console.error('[extraction] Claude photo extraction failed, degrading to presence-only:', err.message);
    return { data: {}, source: 'none' };
  }
}
