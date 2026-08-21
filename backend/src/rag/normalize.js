// Text normalization between raw PDF/web extraction and chunking.
//
// Some source PDFs have a broken space-encoding (missing ToUnicode mapping
// for the space glyph) — real text comes out with words glued together,
// e.g. "Readandsavetheseinstructions". This is a defect in the source file
// itself, not a bug in extraction (verified: pdf-parse's own default
// renderer produces the same glued output for the affected file).
//
// The only fix applied here is inserting a space at an unambiguous
// lowercase->uppercase boundary ("ReadThis" -> "Read This") — a boundary
// that's already visually/semantically present in the text via
// capitalization, so this never invents characters, only whitespace. It
// does NOT touch letter/digit boundaries, deliberately: model codes like
// "24VNA6" must stay glued for retrieval and citation accuracy. It will
// NOT fully recover an all-lowercase glued run ("andsavetheseinstructions")
// — there's no safe, non-inventive way to do that, so it's left as-is; see
// README Known Limitations.
export function normalizeText(text) {
  return (text || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
