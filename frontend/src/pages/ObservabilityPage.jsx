import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

// Everything on this page is read straight from the backend's aggregates over
// real recorded agent_runs. Nothing is estimated client-side — where the
// backend reports null (unknown model rate, no telemetry on old rows), this
// renders that gap explicitly rather than showing a confident zero.

function fmtMoney(v) {
  if (v === null || v === undefined) return '—';
  if (v === 0) return '$0.00';
  // Real per-call costs here are fractions of a cent; 2dp would floor them.
  return v < 0.01 ? `$${v.toFixed(6)}` : `$${v.toFixed(4)}`;
}

function fmtNum(v) {
  if (v === null || v === undefined) return '—';
  return v.toLocaleString();
}

function fmtMs(v) {
  if (v === null || v === undefined) return '—';
  return v >= 1000 ? `${(v / 1000).toFixed(2)}s` : `${v}ms`;
}

export default function ObservabilityPage() {
  const [summary, setSummary] = useState(null);
  const [runs, setRuns] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [s, r] = await Promise.all([api.getObservabilitySummary(), api.listAgentRuns({ limit: 25 })]);
      setSummary(s);
      setRuns(r);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="card">
      <Link className="back-link" to="/supervisor">← Back to dashboard</Link>
      <div className="task-header">
        <div>
          <h1>Observability</h1>
          <p className="muted">
            Token usage, cost, latency and prompt versions — measured from every real pipeline run, not estimated.
          </p>
        </div>
        <button className="btn secondary" onClick={load} disabled={loading}>
          {loading ? 'Loading…' : '↻ Refresh'}
        </button>
      </div>

      {error && <p className="error-text">{error}</p>}
      {!summary && loading && <p className="muted">Loading…</p>}

      {summary && (
        <>
          <section className="section">
            <h2>Totals</h2>
            <div className="report-stat-row">
              <div className="report-stat">
                <div className="report-stat-value">{fmtNum(summary.totals.total_runs)}</div>
                <div className="report-stat-label">Pipeline runs</div>
              </div>
              <div className="report-stat">
                <div className="report-stat-value">{fmtNum(summary.totals.model_calls)}</div>
                <div className="report-stat-label">Model calls</div>
              </div>
              <div className="report-stat">
                <div className="report-stat-value">{fmtNum(summary.totals.total_tokens)}</div>
                <div className="report-stat-label">Total tokens</div>
              </div>
              <div className="report-stat">
                <div className="report-stat-value">{fmtNum(summary.totals.input_tokens)}</div>
                <div className="report-stat-label">Input tokens</div>
              </div>
              <div className="report-stat">
                <div className="report-stat-value">{fmtNum(summary.totals.output_tokens)}</div>
                <div className="report-stat-label">Output tokens</div>
              </div>
              <div className="report-stat">
                <div className="report-stat-value">{fmtMoney(summary.totals.cost_usd)}</div>
                <div className="report-stat-label">Total cost</div>
              </div>
              <div className="report-stat">
                <div className="report-stat-value">{fmtMoney(summary.totals.avg_cost_per_model_call_usd)}</div>
                <div className="report-stat-label">Avg / model call</div>
              </div>
              <div className="report-stat">
                <div className="report-stat-value">{fmtNum(summary.totals.heuristic_fallbacks)}</div>
                <div className="report-stat-label">Heuristic fallbacks</div>
              </div>
            </div>
            <p className="muted small">
              Pricing table last updated {summary.pricing_updated}. Telemetry covers{' '}
              {fmtNum(summary.coverage.runs_with_telemetry)} of {fmtNum(summary.coverage.runs_in_range)} runs in range —
              older runs predate instrumentation and are excluded from these aggregates rather than counted as zero.
            </p>
          </section>

          <section className="section">
            <h2>Latency by pipeline step</h2>
            {summary.latency.length === 0 ? (
              <p className="muted">No timed runs yet.</p>
            ) : (
              <div className="table-scroll">
                <table className="field-table">
                  <thead>
                    <tr>
                      <th>Step</th>
                      <th>Calls</th>
                      <th>p50</th>
                      <th>p95</th>
                      <th>Max</th>
                      <th>Avg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.latency.map((l) => (
                      <tr key={l.step}>
                        <td className="field-key">{l.step}</td>
                        <td>{fmtNum(l.calls)}</td>
                        <td>{fmtMs(l.p50_ms)}</td>
                        <td><strong>{fmtMs(l.p95_ms)}</strong></td>
                        <td>{fmtMs(l.max_ms)}</td>
                        <td>{fmtMs(l.avg_ms)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="section">
            <h2>Cost by model</h2>
            {summary.models.length === 0 ? (
              <p className="muted">
                No model calls recorded in this range — every extraction ran on the deterministic fallback path.
              </p>
            ) : (
              <div className="table-scroll">
                <table className="field-table">
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th>Calls</th>
                      <th>Input</th>
                      <th>Output</th>
                      <th>Rate (in / out per MTok)</th>
                      <th>Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.models.map((m) => (
                      <tr key={m.model}>
                        <td className="field-key">{m.model}</td>
                        <td>{fmtNum(m.calls)}</td>
                        <td>{fmtNum(m.input_tokens)}</td>
                        <td>{fmtNum(m.output_tokens)}</td>
                        <td>
                          {m.rate_input_per_mtok === null
                            ? <span className="muted">unknown</span>
                            : `$${m.rate_input_per_mtok} / $${m.rate_output_per_mtok}`}
                          {m.rate_tier === 'introductory' && <span className="citation-chip"> introductory</span>}
                        </td>
                        <td>{fmtMoney(m.cost_usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="section">
            <h2>Prompt versions</h2>
            <p className="muted small">
              Every prompt sent is recorded with its registered version and a hash of the exact text. Two different
              hashes under one version means a template was edited without a version bump.
            </p>
            <div className="prompt-version-list">
              {summary.prompts.map((p) => (
                <div key={p.prompt_key} className="prompt-version-card">
                  <div className="prompt-version-head">
                    <span className="field-key">{p.prompt_key}</span>
                    <span className="prompt-version-badge">v{p.registered_version}</span>
                  </div>
                  {p.observed.length === 0 ? (
                    <p className="muted small">Not exercised in this range.</p>
                  ) : (
                    <ul className="prompt-version-observed">
                      {p.observed.map((o) => (
                        <li key={o.version}>
                          v{o.version} — {fmtNum(o.calls)} call{o.calls === 1 ? '' : 's'}, {o.distinct_hashes} distinct
                          text hash{o.distinct_hashes === 1 ? '' : 'es'}
                          {o.drift && <span className="field-status field-status-mismatch">version drift</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                  <details className="prompt-changelog">
                    <summary className="muted small">Changelog</summary>
                    <ul>
                      {p.changelog.map((c) => (
                        <li key={c} className="muted small">{c}</li>
                      ))}
                    </ul>
                  </details>
                </div>
              ))}
            </div>
          </section>

          <section className="section">
            <h2>Fallbacks to the deterministic path</h2>
            {summary.fallbacks.attempts === 0 ? (
              <p className="muted">No extraction attempts recorded in this range.</p>
            ) : (
              <>
                <p className="muted small">
                  {fmtNum(summary.fallbacks.count)} of {fmtNum(summary.fallbacks.attempts)} extraction attempts ran
                  without AI ({Math.round((summary.fallbacks.rate || 0) * 100)}%).
                </p>
                <ul className="guide-steps">
                  {Object.entries(summary.fallbacks.by_reason).map(([reason, count]) => (
                    <li key={reason}>
                      <code>{reason}</code> — {fmtNum(count)}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <section className="section">
            <h2>Recent runs</h2>
            <div className="table-scroll">
              <table className="field-table">
                <thead>
                  <tr>
                    <th>Step</th>
                    <th>Mode</th>
                    <th>Model</th>
                    <th>Prompt</th>
                    <th>Latency</th>
                    <th>Tokens</th>
                    <th>Cost</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id}>
                      <td className="field-key">{r.step}</td>
                      <td>{r.mode ? <span className={`field-status field-status-${r.mode === 'claude' ? 'ok' : 'missing'}`}>{r.mode}</span> : <span className="muted">—</span>}</td>
                      <td className="muted small">{r.model || '—'}</td>
                      <td className="muted small">{r.prompt_version ? `v${r.prompt_version}` : '—'}</td>
                      <td>{fmtMs(r.duration_ms)}</td>
                      <td className="muted small">
                        {r.input_tokens === null ? '—' : `${fmtNum(r.input_tokens)} / ${fmtNum(r.output_tokens)}`}
                      </td>
                      <td>{fmtMoney(r.cost_usd)}</td>
                      <td className="muted small">{r.created_at}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
