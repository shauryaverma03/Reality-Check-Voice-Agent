// Extraction layer: voice claim text -> structured fields, photo -> structured
// fields. This is the one file to touch to swap in real STT / a dedicated
// vision model later — everything else talks to this module's two exports,
// never to Claude directly.
//
// If ANTHROPIC_API_KEY is set, both extractors call the Claude API (one text
// call, one vision call). If it's unset, or the call throws/returns garbage,
// they degrade gracefully to a fallback so the pipeline still runs end-to-end
// without a key:
//   - claim text  -> a small regex/heuristic parser
//   - photo       -> presence-only (no OCR without a vision model); the
//                    verifier still treats the photo field as satisfied,
//                    it just can't cross-check numeric/id values from it

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

// ---------------------------------------------------------------------------
// Heuristic fallback for the voice claim (no API key / API failure)
// ---------------------------------------------------------------------------

function heuristicExtractClaim(rawText) {
  const data = {};

  const idMatch = rawText.match(/\b(?:machine|unit)\s*(?:id\s*|no\.?\s*|number\s*)?[:#]?\s*([a-zA-Z]?\d+[a-zA-Z]?)/i);
  if (idMatch) data.machine_id = idMatch[1];

  const pressureMatch = rawText.match(/pressure[^0-9-]*(-?\d+(?:\.\d+)?)/i);
  if (pressureMatch) data.pressure = Number.parseFloat(pressureMatch[1]);

  const tempMatch = rawText.match(/temp(?:erature)?[^0-9-]*(-?\d+(?:\.\d+)?)/i);
  if (tempMatch) data.temperature = Number.parseFloat(tempMatch[1]);

  return data;
}

const CLAIM_SYSTEM_PROMPT = `You extract structured maintenance-job facts from a field technician's spoken claim (transcribed speech, which may mix Hindi and English). Respond with ONLY a JSON object — no prose, no markdown code fences. Include a key only if you are confident it was actually stated; never invent a value. Possible keys:
- "machine_id": string — the unit/machine identifier
- "pressure": number — gas pressure in bar
- "temperature": number — temperature in degrees Celsius`;

/**
 * @param {{ rawText: string }} input
 * @returns {Promise<{ data: object, source: 'claude' | 'heuristic' }>}
 */
export async function extractClaimFromVoice({ rawText }) {
  const anthropic = getClient();
  if (!anthropic) {
    return { data: heuristicExtractClaim(rawText), source: 'heuristic' };
  }
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 300,
      system: CLAIM_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: rawText }],
    });
    const textBlock = response.content?.find((b) => b.type === 'text');
    const parsed = parseJSONFromText(textBlock?.text);
    if (!parsed) throw new Error('Claude returned no parseable JSON for claim extraction');
    return { data: parsed, source: 'claude' };
  } catch (err) {
    console.error('[extraction] Claude claim extraction failed, falling back to heuristic parser:', err.message);
    return { data: heuristicExtractClaim(rawText), source: 'heuristic' };
  }
}

// ---------------------------------------------------------------------------
// Photo extraction
// ---------------------------------------------------------------------------

const PHOTO_SYSTEM_PROMPT = `You read structured facts off a photo submitted as job evidence by an AC/RO maintenance technician. It's either a nameplate/serial-number label or a gauge / final-condition shot. Respond with ONLY a JSON object — no prose, no markdown code fences. Include a key only if it is actually legible in the photo; never invent a value. Possible keys:
- "machine_id": string — a printed serial/unit number, if visible
- "pressure": number — a pressure gauge reading in bar, if visible
- "temperature": number — a temperature readout in degrees Celsius, if visible`;

/**
 * @param {{ buffer: Buffer, mimeType: string, role: string }} input
 * @returns {Promise<{ data: object, source: 'claude' | 'none' }>}
 */
export async function extractEvidenceFromPhoto({ buffer, mimeType, role }) {
  const anthropic = getClient();
  if (!anthropic) {
    // No OCR without a vision model — degrade to presence-only. The verifier
    // still treats this evidence item as satisfying the photo field.
    return { data: {}, source: 'none' };
  }
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 300,
      system: PHOTO_SYSTEM_PROMPT,
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
