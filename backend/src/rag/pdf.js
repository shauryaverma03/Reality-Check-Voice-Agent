// Text extraction for knowledge-base uploads. PDF via pdf-parse (local,
// offline, no API call); anything else is treated as plain UTF-8 text. Never
// throws — a file that can't be read yields '' and the route reports that
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
