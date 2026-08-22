// Telemetry record builders — one flat, uniform shape for every model call
// (and every non-model fallback), so agent_runs can be aggregated without
// per-step special-casing.
//
// Deliberately records the no-AI path too: knowing that 40% of extractions
// fell back to the heuristic parser — and WHY (no key vs. an API error) — is
// exactly the kind of thing that's invisible until something breaks.

import { computeCost, normalizeUsage } from './pricing.js';
import { promptMeta } from './prompts.js';

/** A real Anthropic API call: latency, tokens, cost, model, prompt version. */
export function apiTelemetry(promptKey, startedMs, model, renderedPrompt, response) {
  const usage = normalizeUsage(response?.usage);
  const { cost_usd, rate_tier } = usage ? computeCost({ model, ...usage }) : { cost_usd: null, rate_tier: null };
  return {
    mode: 'claude',
    duration_ms: Math.round(performance.now() - startedMs),
    model,
    ...promptMeta(promptKey, renderedPrompt),
    ...(usage || {}),
    cost_usd,
    rate_tier,
    stop_reason: response?.stop_reason ?? null,
    fallback_reason: null,
  };
}

/** The deterministic/no-AI path: latency only, and an explicit reason. */
export function heuristicTelemetry(promptKey, startedMs, fallbackReason) {
  return {
    mode: 'heuristic',
    duration_ms: Math.round(performance.now() - startedMs),
    model: null,
    prompt_key: promptKey,
    prompt_version: null,
    prompt_hash: null,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    cost_usd: 0,
    rate_tier: null,
    stop_reason: null,
    fallback_reason: fallbackReason,
  };
}

/** For non-model pipeline steps (RAG retrieval, the verifier) — latency only. */
export function stepTelemetry(startedMs, extra = {}) {
  return {
    mode: 'deterministic',
    duration_ms: Math.round(performance.now() - startedMs),
    model: null,
    prompt_key: null,
    prompt_version: null,
    prompt_hash: null,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    cost_usd: 0,
    rate_tier: null,
    stop_reason: null,
    fallback_reason: null,
    ...extra,
  };
}
