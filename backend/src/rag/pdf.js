// Text extraction for knowledge-base uploads. PDF via pdf-parse (local,
// offline, no API call); anything else is treated as plain UTF-8 text. Never
// throws — a file that can't be read yields '' and the caller reports that
// honestly rather than indexing garbage or silently failing.

import pdfParse from 'pdf-parse';

/**
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @returns {Promise<string>}
 */
export async function extractText(buffer, mimeType) {
  if (mimeType === 'application/pdf') {
    try {
      const result = await pdfParse(buffer);
      return result.text || '';
    } catch (err) {
      console.error('[rag] pdf-parse failed to read this PDF:', err.message);
      return '';
    }
  }
  // .txt and anything else unrecognized: best-effort plain-text decode.
  try {
    return buffer.toString('utf8');
  } catch {
    return '';
  }
}

/**
 * Page-aware, line-structured extraction — the ingestion pipeline needs
 * this so a citation can say "page 42" instead of just "this PDF
 * somewhere", and so chunking (rag/chunk.js) can detect section headings
 * from real font-size information already present in the PDF (never
 * guessed from content). Uses pdf-parse's `pagerender` hook (it already
 * depends on pdfjs-dist internally) to walk each page's text items,
 * grouping them into lines by Y-position and recording each line's max
 * font size from its glyph transform matrix.
 *
 * @param {Buffer} buffer
 * @returns {Promise<{ pageNumber: number, lines: { text: string, fontSize: number }[] }[]>} empty array on failure
 */
export async function extractPages(buffer) {
  const pages = [];
  try {
    await pdfParse(buffer, {
      pagerender: async (pageData) => {
        const textContent = await pageData.getTextContent();
        const lines = [];
        let current = null;
        for (const item of textContent.items) {
          const y = item.transform[5];
          const fontSize = Math.abs(item.transform[3]) || Math.abs(item.transform[0]) || 0;
          if (current && Math.abs(y - current.y) <= 1) {
            current.text += item.str;
            current.fontSize = Math.max(current.fontSize, fontSize);
          } else {
            if (current) lines.push({ text: current.text, fontSize: current.fontSize });
            current = { y, text: item.str, fontSize };
          }
        }
        if (current) lines.push({ text: current.text, fontSize: current.fontSize });
        pages.push({ pageNumber: pageData.pageNumber, lines });
        return lines.map((l) => l.text).join('\n');
      },
    });
  } catch (err) {
    console.error('[rag] pdf-parse page-aware extraction failed:', err.message);
    return [];
  }
  return pages;
}
