// Plain-text chunking for the knowledge base. Deliberately dumb: fixed-size
// character windows with a small overlap so a fact split across a window
// boundary still shows up whole in at least one chunk. No sentence-boundary
// awareness, no NLP — a hackathon-appropriate amount of cleverness.

const DEFAULT_SIZE = 800;
const DEFAULT_OVERLAP = 100;

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

/**
 * Page-aware chunking for PDF ingestion: chunks each page's text
 * independently (same sliding-window algorithm as chunkText) so every
 * resulting chunk can carry the real page number it came from — a chunk
 * never spans two pages, which is what lets a citation say "page 42"
 * accurately rather than guessing.
 *
 * @param {{ pageNumber: number, text: string }[]} pages
 * @param {{ size?: number, overlap?: number }} [opts]
 * @returns {{ text: string, page: number }[]}
 */
export function chunkPages(pages, opts) {
  const result = [];
  for (const { pageNumber, text } of pages) {
    for (const chunkedText of chunkText(text, opts)) {
      result.push({ text: chunkedText, page: pageNumber });
    }
  }
  return result;
}
