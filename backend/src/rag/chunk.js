// Plain-text chunking for the knowledge base. Deliberately dumb: fixed-size
// character windows with a small overlap so a fact split across a window
// boundary still shows up whole in at least one chunk. No sentence-boundary
// awareness, no NLP — a hackathon-appropriate amount of cleverness.

import { normalizeText } from './normalize.js';

const DEFAULT_SIZE = 800;
const DEFAULT_OVERLAP = 100;

// A line counts as a heading if it's meaningfully bigger than the page's
// own body-text font size (a real, already-present signal from the PDF's
// glyph metrics — never guessed from content), short, and doesn't end like
// a sentence.
const HEADING_FONT_RATIO = 1.15;
const HEADING_MAX_LENGTH = 80;

/**
 * @param {string} text
 * @param {{ size?: number, overlap?: number }} [opts]
 * @returns {string[]}
 */
export function chunkText(text, { size = DEFAULT_SIZE, overlap = DEFAULT_OVERLAP } = {}) {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];

  const chunks = [];
  let start = 0;
  while (start < clean.length) {
    const end = Math.min(start + size, clean.length);
    chunks.push(clean.slice(start, end));
    if (end === clean.length) break;
    start = end - overlap;
  }
  return chunks;
}

/** The page's body-text font size — the rounded size that covers the most characters (not just the most lines, so a handful of large-font words don't outvote three paragraphs of body text). */
function detectBodyFontSize(lines) {
  const weightBySize = new Map();
  for (const { text, fontSize } of lines) {
    if (!text.trim()) continue;
    const rounded = Math.round(fontSize);
    weightBySize.set(rounded, (weightBySize.get(rounded) || 0) + text.length);
  }
  let bodySize = 0;
  let bestWeight = -1;
  for (const [size, weight] of weightBySize) {
    if (weight > bestWeight) {
      bestWeight = weight;
      bodySize = size;
    }
  }
  return bodySize;
}

function isHeadingLine(line, bodySize) {
  const text = line.text.trim();
  if (!text || text.length > HEADING_MAX_LENGTH) return false;
  if (/[.!?]$/.test(text)) return false; // sentences aren't headings, even large-font pull quotes
  if (bodySize <= 0) return false;
  return line.fontSize >= bodySize * HEADING_FONT_RATIO;
}

/**
 * Page- and section-aware chunking for PDF ingestion: walks each page's
 * lines, tracking the current heading (detected via isHeadingLine above)
 * as it goes, and chunks the body text between headings independently —
 * so a chunk never spans two pages OR two sections, and can carry both a
 * real page number and (when one was detected) a real section title.
 *
 * @param {{ pageNumber: number, lines: { text: string, fontSize: number }[] }[]} pages
 * @param {{ size?: number, overlap?: number }} [opts]
 * @returns {{ text: string, page: number, section: string | null }[]}
 */
export function chunkPages(pages, opts) {
  const result = [];
  for (const { pageNumber, lines } of pages) {
    const bodySize = detectBodyFontSize(lines);
    let currentSection = null;
    let segmentLines = [];

    const flushSegment = () => {
      if (segmentLines.length === 0) return;
      const segmentText = normalizeText(segmentLines.join(' '));
      for (const chunkedText of chunkText(segmentText, opts)) {
        result.push({ text: chunkedText, page: pageNumber, section: currentSection });
      }
      segmentLines = [];
    };

    for (const line of lines) {
      if (isHeadingLine(line, bodySize)) {
        flushSegment();
        currentSection = normalizeText(line.text.trim());
        continue;
      }
      if (line.text.trim()) segmentLines.push(line.text);
    }
    flushSegment();
  }
  return result;
}
