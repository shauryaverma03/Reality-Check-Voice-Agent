// Eval harness for the observability layer — npm run eval:observability
//
// Same dependency-free, offline style as the other suites. Cost arithmetic is
// the part most worth pinning down: a silently-wrong multiplier here produces
// a dashboard that looks authoritative and is wrong, which is worse than no
// dashboard. Rates are asserted against Anthropic's published per-MTok
// pricing, so if this file and the pricing table ever disagree, one of them
// is stale and the suite says so.

import { computeCost, ratesFor, normalizeUsage } from './pricing.js';
import { promptMeta, hashPrompt, PROMPTS } from './prompts.js';
import { apiTelemetry, heuristicTelemetry, stepTelemetry } from './telemetry.js';

const cases = [];
function testCase(name, run) {
  cases.push({ name, run });
}

// ---------------------------------------------------------------------------
// Cost computation
// ---------------------------------------------------------------------------

testCase('Sonnet 5 standard rate: 1M in + 1M out = $3.00 + $15.00', () => {
  const { cost_usd } = computeCost(
    { model: 'claude-sonnet-5', input_tokens: 1_000_000, output_tokens: 1_000_000 },
    '2026-09-01' // after the introductory window
  );
  return cost_usd === 18.0;
});

testCase('Sonnet 5 introductory rate applies on/before 2026-08-31: $2.00 + $10.00', () => {
  const { cost_usd, rate_tier } = computeCost(
    { model: 'claude-sonnet-5', input_tokens: 1_000_000, output_tokens: 1_000_000 },
    '2026-08-22'
  );
  return cost_usd === 12.0 && rate_tier === 'introductory';
});

testCase('Introductory pricing expires the day after its `through` date', () => {
  const before = ratesFor('claude-sonnet-5', '2026-08-31');
  const after = ratesFor('claude-sonnet-5', '2026-09-01');
  return before.tier === 'introductory' && after.tier === 'standard';
});

testCase('Opus 5: 1M in + 1M out = $5.00 + $25.00', () => {
  const { cost_usd } = computeCost({ model: 'claude-opus-5', input_tokens: 1_000_000, output_tokens: 1_000_000 });
  return cost_usd === 30.0;
});

testCase('Haiku 4.5: 1M in + 1M out = $1.00 + $5.00', () => {
  const { cost_usd } = computeCost({ model: 'claude-haiku-4-5', input_tokens: 1_000_000, output_tokens: 1_000_000 });
  return cost_usd === 6.0;
});

testCase('A realistic single extraction call costs a fraction of a cent, and is NOT rounded to zero', () => {
  // ~700 in / ~80 out is the real shape of this app's extraction calls.
  const { cost_usd } = computeCost(
    { model: 'claude-sonnet-5', input_tokens: 700, output_tokens: 80 },
    '2026-09-01'
  );
  // 700/1e6*3 + 80/1e6*15 = 0.0021 + 0.0012 = 0.0033
  return cost_usd === 0.0033 && cost_usd > 0;
});

testCase('Cache reads bill at 10% of the input rate, cache writes at 125%', () => {
  const { cost_usd } = computeCost(
    { model: 'claude-sonnet-5', input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000 },
    '2026-09-01'
  );
  // 3.00 * 0.1 + 3.00 * 1.25 = 0.30 + 3.75 = 4.05
  return cost_usd === 4.05;
});

testCase('An unknown model reports cost as null, never a fabricated $0', () => {
  const { cost_usd, rate_tier } = computeCost({ model: 'some-unreleased-model', input_tokens: 5000, output_tokens: 500 });
  return cost_usd === null && rate_tier === null;
});

testCase('normalizeUsage defaults every missing token field to 0 and returns null for no usage', () => {
  const partial = normalizeUsage({ input_tokens: 12 });
  return (
    normalizeUsage(undefined) === null &&
    partial.input_tokens === 12 &&
    partial.output_tokens === 0 &&
    partial.cache_read_input_tokens === 0
  );
});

// ---------------------------------------------------------------------------
// Prompt versioning
// ---------------------------------------------------------------------------

testCase('Every registered prompt has a semver version and a changelog', () => {
  return Object.values(PROMPTS).every(
    (p) => /^\d+\.\d+\.\d+$/.test(p.version) && Array.isArray(p.changelog) && p.changelog.length > 0
  );
});

testCase('The same prompt text always hashes the same; a one-character change does not', () => {
  const a = hashPrompt('Extract the machine id.');
  const b = hashPrompt('Extract the machine id.');
  const c = hashPrompt('Extract the machine ID.');
  return a === b && a !== c && a.length === 12;
});

testCase('promptMeta reports the registered version for a known prompt', () => {
  const meta = promptMeta('claim_extraction', 'some rendered prompt');
  return meta.prompt_key === 'claim_extraction' && meta.prompt_version === PROMPTS.claim_extraction.version;
});

testCase('An unregistered prompt key is flagged, not silently given a version', () => {
  return promptMeta('not_a_real_prompt', 'text').prompt_version === 'unregistered';
});

// ---------------------------------------------------------------------------
// Telemetry record shape
// ---------------------------------------------------------------------------

testCase('apiTelemetry captures tokens, cost, model, prompt version and a real duration', () => {
  const started = performance.now() - 250; // simulate a 250ms call
  const t = apiTelemetry('claim_extraction', started, 'claude-sonnet-5', 'prompt text', {
    usage: { input_tokens: 700, output_tokens: 80 },
    stop_reason: 'end_turn',
  });
  return (
    t.mode === 'claude' &&
    t.model === 'claude-sonnet-5' &&
    t.input_tokens === 700 &&
    t.output_tokens === 80 &&
    t.cost_usd > 0 &&
    t.prompt_version === PROMPTS.claim_extraction.version &&
    t.duration_ms >= 240 &&
    t.stop_reason === 'end_turn'
  );
});

testCase('heuristicTelemetry records latency + an explicit reason, with zero tokens and zero cost', () => {
  const t = heuristicTelemetry('claim_extraction', performance.now() - 30, 'no_api_key');
  return (
    t.mode === 'heuristic' &&
    t.model === null &&
    t.input_tokens === 0 &&
    t.cost_usd === 0 &&
    t.fallback_reason === 'no_api_key' &&
    t.duration_ms >= 20
  );
});

testCase('stepTelemetry (deterministic steps) records latency only and carries extra fields through', () => {
  const t = stepTelemetry(performance.now() - 15, { fields_retrieved: 2 });
  return t.mode === 'deterministic' && t.duration_ms >= 10 && t.cost_usd === 0 && t.fields_retrieved === 2;
});

testCase('A telemetry record never reports a negative or NaN duration', () => {
  const t = stepTelemetry(performance.now());
  return Number.isFinite(t.duration_ms) && t.duration_ms >= 0;
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

function main() {
  console.log(`\nRealityCheck observability eval — ${cases.length} cases\n`);
  let passed = 0;
  cases.forEach((c, i) => {
    const num = String(i + 1).padStart(2, '0');
    let ok = false;
    let err = null;
    try {
      ok = c.run() === true;
    } catch (e) {
      err = e.message;
    }
    if (ok) {
      passed += 1;
      console.log(`  PASS ${num}  ${c.name}`);
    } else {
      console.log(`  FAIL ${num}  ${c.name}${err ? ` — threw: ${err}` : ''}`);
    }
  });
  console.log(`\n${passed}/${cases.length} passed (${Math.round((passed / cases.length) * 100)}%)\n`);
  if (passed !== cases.length) process.exitCode = 1;
}

main();
