// Resource: /api/v1/observability
//
// Aggregates the telemetry recorded on agent_runs (see
// observability/telemetry.js) into the four things this project claims to
// track: token usage, cost, latency, and prompt versions — plus the current
// state of the eval harnesses.
//
// Everything here is computed from real recorded rows. Steps that predate
// telemetry, or that never called a model, store NULLs and are excluded from
// the relevant aggregate rather than counted as zero — a step with unknown
// latency must not drag an average down toward 0.

import { Router } from 'express';
import { db } from '../db/index.js';
import { PROMPTS } from '../observability/prompts.js';
import { PRICING_UPDATED, ratesFor } from '../observability/pricing.js';

const router = Router();

/** Nearest-rank percentile over an ascending array. Returns null for empty
 * input rather than 0 — "no data" and "0ms" are different claims. */
function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return null;
  const rank = Math.ceil((p / 100) * sortedAsc.length);
  return sortedAsc[Math.min(Math.max(rank, 1), sortedAsc.length) - 1];
}

function dateRange(query) {
  const today = new Date().toISOString().slice(0, 10);
  const from = query.from || query.date || '1970-01-01';
  const to = query.to || query.date || today;
  return { from, to };
}

// GET /api/v1/observability/summary?from=&to=&date=
router.get('/summary', (req, res) => {
  const { from, to } = dateRange(req.query);

  const runs = db
    .prepare(
      `SELECT step, mode, model, prompt_key, prompt_version, prompt_hash,
              duration_ms, input_tokens, output_tokens, cost_usd, rate_tier,
              fallback_reason, created_at
       FROM agent_runs
       WHERE date(created_at) BETWEEN date(?) AND date(?)
       ORDER BY created_at ASC`
    )
    .all(from, to);

  const withTokens = runs.filter((r) => r.input_tokens !== null || r.output_tokens !== null);
  const modelCalls = runs.filter((r) => r.mode === 'claude');
  const heuristicCalls = runs.filter((r) => r.mode === 'heuristic');

  const totals = {
    total_runs: runs.length,
    model_calls: modelCalls.length,
    heuristic_fallbacks: heuristicCalls.length,
    input_tokens: withTokens.reduce((s, r) => s + (r.input_tokens || 0), 0),
    output_tokens: withTokens.reduce((s, r) => s + (r.output_tokens || 0), 0),
    // Only rows that actually carry a cost contribute; a NULL cost (unknown
    // model rate) is surfaced separately rather than folded in as zero.
    cost_usd: Number(runs.reduce((s, r) => s + (r.cost_usd || 0), 0).toFixed(6)),
    cost_unknown_calls: modelCalls.filter((r) => r.cost_usd === null).length,
  };
  totals.total_tokens = totals.input_tokens + totals.output_tokens;
  totals.avg_cost_per_model_call_usd =
    modelCalls.length > 0 ? Number((totals.cost_usd / modelCalls.length).toFixed(6)) : null;

  // Latency, per pipeline step. Steps are grouped by their base name so
  // "extract_evidence:serial_photo" and ":final_photo" aggregate together —
  // per-role latency isn't a meaningful distinction, per-step is.
  const byStep = new Map();
  for (const r of runs) {
    if (r.duration_ms === null) continue;
    const key = r.step.split(':')[0];
    if (!byStep.has(key)) byStep.set(key, []);
    byStep.get(key).push(r.duration_ms);
  }
  const latency = [...byStep.entries()]
    .map(([step, values]) => {
      const sorted = [...values].sort((a, b) => a - b);
      return {
        step,
        calls: sorted.length,
        p50_ms: percentile(sorted, 50),
        p95_ms: percentile(sorted, 95),
        max_ms: sorted[sorted.length - 1],
        avg_ms: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
      };
    })
    .sort((a, b) => b.p95_ms - a.p95_ms);

  // Per-model usage + cost.
  const byModel = new Map();
  for (const r of modelCalls) {
    const key = r.model || '(unknown)';
    if (!byModel.has(key)) byModel.set(key, { model: key, calls: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 });
    const m = byModel.get(key);
    m.calls += 1;
    m.input_tokens += r.input_tokens || 0;
    m.output_tokens += r.output_tokens || 0;
    m.cost_usd += r.cost_usd || 0;
  }
  const models = [...byModel.values()].map((m) => {
    const rates = ratesFor(m.model);
    return {
      ...m,
      cost_usd: Number(m.cost_usd.toFixed(6)),
      rate_input_per_mtok: rates ? rates.input : null,
      rate_output_per_mtok: rates ? rates.output : null,
      rate_tier: rates ? rates.tier : null,
    };
  });

  // Prompt versions actually observed in this window, vs. what's registered.
  // A registered prompt with two distinct hashes under one version means
  // someone edited the template without bumping the version — surfaced as a
  // real inconsistency rather than hidden.
  const promptSeen = new Map();
  for (const r of runs) {
    if (!r.prompt_key || !r.prompt_version) continue;
    const key = `${r.prompt_key}@${r.prompt_version}`;
    if (!promptSeen.has(key)) {
      promptSeen.set(key, { prompt_key: r.prompt_key, version: r.prompt_version, calls: 0, hashes: new Set() });
    }
    const p = promptSeen.get(key);
    p.calls += 1;
    if (r.prompt_hash) p.hashes.add(r.prompt_hash);
  }
  const prompts = Object.entries(PROMPTS).map(([key, def]) => {
    const observed = [...promptSeen.values()].filter((p) => p.prompt_key === key);
    return {
      prompt_key: key,
      registered_version: def.version,
      changelog: def.changelog,
      observed: observed.map((o) => ({
        version: o.version,
        calls: o.calls,
        distinct_hashes: o.hashes.size,
        // More than one hash under a single version = the template changed
        // without a version bump.
        drift: o.hashes.size > 1,
      })),
    };
  });

  // Why calls fell back to the deterministic path — the single most useful
  // signal for "is the AI layer actually working right now".
  const fallbackReasons = {};
  for (const r of heuristicCalls) {
    const reason = (r.fallback_reason || 'unknown').split(':')[0].trim();
    fallbackReasons[reason] = (fallbackReasons[reason] || 0) + 1;
  }

  // The fallback rate is a property of EXTRACTION attempts, so the
  // denominator is model-or-heuristic runs only. Dividing by every
  // agent_run would dilute it with deterministic steps (verify, retrieval)
  // and pre-telemetry rows that never had a mode at all — making a 100%
  // outage look like a 2% blip.
  const extractionAttempts = modelCalls.length + heuristicCalls.length;

  res.json({
    range: { from, to },
    pricing_updated: PRICING_UPDATED,
    totals,
    latency,
    models,
    prompts,
    fallbacks: {
      count: heuristicCalls.length,
      attempts: extractionAttempts,
      rate: extractionAttempts > 0 ? Number((heuristicCalls.length / extractionAttempts).toFixed(3)) : null,
      by_reason: fallbackReasons,
    },
    // Rows written before telemetry existed carry no mode/latency/cost and
    // are excluded from every aggregate above — reported here so the numbers
    // are never mistaken for covering the full history.
    coverage: {
      runs_in_range: runs.length,
      runs_with_telemetry: runs.filter((r) => r.mode !== null).length,
    },
  });
});

// GET /api/v1/observability/runs?limit=&step=
// The raw trace — most recent first. This is the drill-down behind the
// aggregates above.
router.get('/runs', (req, res) => {
  const limit = Math.min(Number.parseInt(req.query.limit, 10) || 50, 500);
  const step = req.query.step;
  const rows = step
    ? db
        .prepare(
          `SELECT id, task_id, step, mode, model, prompt_version, duration_ms,
                  input_tokens, output_tokens, cost_usd, fallback_reason, created_at
           FROM agent_runs WHERE step LIKE ? ORDER BY created_at DESC LIMIT ?`
        )
        .all(`${step}%`, limit)
    : db
        .prepare(
          `SELECT id, task_id, step, mode, model, prompt_version, duration_ms,
                  input_tokens, output_tokens, cost_usd, fallback_reason, created_at
           FROM agent_runs ORDER BY created_at DESC LIMIT ?`
        )
        .all(limit);
  res.json(rows);
});

export default router;
