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
 * Page-aware extraction — the ingestion pipeline needs this so a citation
 * can say "page 42" instead of just "this PDF somewhere". Uses pdf-parse's
 * `pagerender` hook (it already depends on pdfjs-dist internally) to walk
 * each page's text items and reconstruct line breaks from Y-position jumps,
 * capturing the real page number alongside each page's text.
 *
 * @param {Buffer} buffer
 * @returns {Promise<{ pageNumber: number, text: string }[]>} empty array on failure
 */
export async function extractPages(buffer) {
  const pages = [];
  try {
    await pdfParse(buffer, {
      pagerender: async (pageData) => {
        const textContent = await pageData.getTextContent();
        let lastY;
        let text = '';
        for (const item of textContent.items) {
          if (lastY !== undefined && Math.abs(item.transform[5] - lastY) > 1) text += '\n';
          text += item.str;
          lastY = item.transform[5];
        }
        pages.push({ pageNumber: pageData.pageNumber, text });
        return text;
      },
    });
  } catch (err) {
    console.error('[rag] pdf-parse page-aware extraction failed:', err.message);
    return [];
  }
  return pages;
}
