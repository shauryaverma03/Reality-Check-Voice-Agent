// Curated web-knowledge sources — a small, hand-picked list of authoritative
// pages, never a crawl. Each entry was individually chosen and verified
// (reachable, robots.txt-compliant for that exact path, real on-topic
// content) — see README "Knowledge Sources" for how and when.
//
// Fetched live over plain HTTP at ingest time (Node's built-in fetch, no
// browser/JS rendering) — this genuinely is a real-time fetch when you run
// `npm run ingest:knowledge` with network access, not a cached snapshot
// pretending to be one. A source that fails to fetch (offline, blocked,
// moved) is skipped with a warning — ingestion never crashes or fabricates
// content for a source it couldn't reach.

export const USER_AGENT = 'RealityCheck-KnowledgeIngest/1.0 (+hackathon RAG demo; educational, non-commercial)';

export const WEB_SOURCES = [
  {
    taskType: 'ac-service',
    url: 'https://www.carrier.com/us/en/residential/hvac-resources/air-conditioners/troubleshoot-an-ac-not-working/',
    title: 'Troubleshoot an Air Conditioner: 6 Steps to Fix an AC Not Working',
    publisher: 'Carrier (official manufacturer support)',
  },
  {
    taskType: 'ro-service',
    url: 'https://www.epa.gov/sdwa/secondary-drinking-water-standards-guidance-nuisance-chemicals',
    title: 'Secondary Drinking Water Standards: Guidance for Nuisance Chemicals',
    publisher: 'US EPA (government drinking-water standards)',
  },
  {
    taskType: 'fridge-service',
    url: 'https://producthelp.whirlpool.com/Refrigeration/Full-Size_Refrigerators/Product_Info/Product_Assistance/Tips_for_Properly_Setting_the_Controls',
    title: 'Tips for Properly Setting the Controls',
    publisher: 'Whirlpool (official manufacturer support)',
  },
  {
    taskType: 'washer-service',
    url: 'https://producthelp.whirlpool.com/Laundry/Washers/Product_Info/Washer_Product_Assistance/Error_Codes_in_Front_Load_Washers',
    title: 'Error Codes in Front Load Washers',
    publisher: 'Whirlpool (official manufacturer support)',
  },
];

/**
 * @param {{ url: string }} source
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<{ ok: true, html: string } | { ok: false, error: string }>}
 */
export async function fetchWebSource(source, { timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(source.url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const html = await res.text();
    return { ok: true, html };
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? `timed out after ${timeoutMs}ms` : err.message };
  } finally {
    clearTimeout(timeout);
  }
}
