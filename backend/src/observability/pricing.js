// Model pricing + cost computation for token/cost tracking.
//
// Rates are USD per 1M tokens, taken from Anthropic's published API pricing.
// Kept as an explicit dated table rather than a single hardcoded number so a
// price change is a visible one-line edit, and so a model we have no rate for
// reports cost as `null` (unknown) instead of silently costing $0 — a fake
// zero in a cost dashboard is worse than an honest gap.

export const PRICING_UPDATED = '2026-06-24';

const RATES = {
  // Sonnet 5 carries introductory pricing through 2026-08-31, after which it
  // reverts to standard. Both are encoded so the number stays correct across
  // that boundary instead of quietly over/under-reporting from Sept 1.
  'claude-sonnet-5': {
    standard: { input: 3.0, output: 15.0 },
    intro: { input: 2.0, output: 10.0, through: '2026-08-31' },
  },
  'claude-opus-5': { standard: { input: 5.0, output: 25.0 } },
  'claude-opus-4-8': { standard: { input: 5.0, output: 25.0 } },
  'claude-fable-5': { standard: { input: 10.0, output: 50.0 } },
  'claude-sonnet-4-6': { standard: { input: 3.0, output: 15.0 } },
  'claude-haiku-4-5': { standard: { input: 1.0, output: 5.0 } },
};

/** The rate card in effect for a model on a given date (ISO yyyy-mm-dd). */
export function ratesFor(model, onDate = new Date().toISOString().slice(0, 10)) {
  const entry = RATES[model];
  if (!entry) return null;
  if (entry.intro && onDate <= entry.intro.through) {
    return { input: entry.intro.input, output: entry.intro.output, tier: 'introductory' };
  }
  return { ...entry.standard, tier: 'standard' };
}

/**
 * @param {{ model: string, input_tokens?: number, output_tokens?: number,
 *   cache_read_input_tokens?: number, cache_creation_input_tokens?: number }} usage
 * @returns {{ cost_usd: number|null, rate_tier: string|null }}
 *   cost_usd is null when we have no rate for the model — never a guessed 0.
 *
 * Cache-read tokens bill at 10% of the input rate and cache-writes at 125%;
 * both are counted here so a cached-heavy workload doesn't look free. This
 * app doesn't currently use prompt caching, so those fields are normally 0.
 */
export function computeCost({ model, input_tokens = 0, output_tokens = 0, cache_read_input_tokens = 0, cache_creation_input_tokens = 0 }, onDate) {
  const rates = ratesFor(model, onDate);
  if (!rates) return { cost_usd: null, rate_tier: null };
  const cost =
    (input_tokens / 1e6) * rates.input +
    (cache_read_input_tokens / 1e6) * rates.input * 0.1 +
    (cache_creation_input_tokens / 1e6) * rates.input * 1.25 +
    (output_tokens / 1e6) * rates.output;
  // 6dp: a single extraction call costs well under a cent, so rounding to
  // 2dp would floor almost every real call to $0.00.
  return { cost_usd: Number(cost.toFixed(6)), rate_tier: rates.tier };
}

/** Normalizes the SDK's usage object into the flat shape we persist. */
export function normalizeUsage(usage) {
  if (!usage) return null;
  return {
    input_tokens: usage.input_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
    cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
  };
}
