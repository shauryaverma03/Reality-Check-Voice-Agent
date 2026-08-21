// Minimal HTML -> text extraction for the web-knowledge pipeline. No cheerio/
// jsdom/framework dependency — a plain regex-based tag strip is adequate for
// TF-IDF retrieval, which doesn't need pixel-perfect formatting, and keeps
// this dependency-free like the rest of rag/.

const ENTITY_MAP = {
  amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ',
  '#8217': '’', '#8216': '‘', '#8220': '“', '#8221': '”', '#8211': '–', '#8212': '—',
  deg: '°', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—',
  hellip: '…', trade: '™', reg: '®', copy: '©', middot: '·', bull: '•',
};

function decodeEntities(text) {
  return text.replace(/&(#\d+|#x[0-9a-f]+|[a-z0-9]+);/gi, (match, code) => {
    if (ENTITY_MAP[code.toLowerCase()]) return ENTITY_MAP[code.toLowerCase()];
    if (/^#\d+$/.test(code)) return String.fromCharCode(Number.parseInt(code.slice(1), 10));
    if (/^#x[0-9a-f]+$/i.test(code)) return String.fromCharCode(Number.parseInt(code.slice(2), 16));
    return match;
  });
}

function stripBlocks(html, tagNames) {
  let out = html;
  for (const tag of tagNames) {
    out = out.replace(new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`, 'gi'), ' ');
  }
  return out;
}

/** Tag-strip + entity-decode + whitespace-collapse a fragment of HTML into plain text. Shared by htmlToText and htmlToSections so both produce identically-cleaned text. */
function fragmentToText(fragment) {
  const text = fragment
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(text).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
}

/** Prefer the first <main> or <article> block (real content), falling back to <body>, falling back to the whole document. */
function extractContentRegion(html) {
  const main = html.match(/<main[^>]*>[\s\S]*?<\/main>/i);
  if (main) return main[0];
  const article = html.match(/<article[^>]*>[\s\S]*?<\/article>/i);
  if (article) return article[0];
  const body = html.match(/<body[^>]*>[\s\S]*?<\/body>/i);
  if (body) return body[0];
  return html;
}

function cleanContentRegion(html) {
  return stripBlocks(extractContentRegion(html), ['script', 'style', 'noscript', 'nav', 'header', 'footer', 'svg', 'form']);
}

/**
 * @param {string} html
 * @returns {string} plain text, best-effort
 */
export function htmlToText(html) {
  if (!html) return '';
  return fragmentToText(cleanContentRegion(html));
}

/**
 * Splits the page on its own <h1>-<h6> headings — a real, semantic signal
 * already present in the HTML, never guessed — so each resulting segment
 * can carry the actual section title it appeared under.
 * @param {string} html
 * @returns {{ section: string | null, text: string }[]}
 */
export function htmlToSections(html) {
  if (!html) return [];
  const region = cleanContentRegion(html);
  const parts = region.split(/(<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>)/gi);

  const sections = [];
  let currentHeading = null;
  let buffer = '';
  for (const part of parts) {
    const headingMatch = part.match(/^<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>$/i);
    if (headingMatch) {
      const text = fragmentToText(buffer);
      if (text) sections.push({ section: currentHeading, text });
      currentHeading = fragmentToText(headingMatch[1]).replace(/\s+/g, ' ').trim() || null;
      buffer = '';
    } else {
      buffer += part;
    }
  }
  const text = fragmentToText(buffer);
  if (text) sections.push({ section: currentHeading, text });
  return sections;
}

/** Best-effort page <title>, for a fallback if no explicit title is configured. */
export function extractHtmlTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeEntities(match[1]).replace(/\s+/g, ' ').trim() : null;
}
