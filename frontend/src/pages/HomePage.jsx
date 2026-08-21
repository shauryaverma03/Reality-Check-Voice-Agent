import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

const STEPS = [
  {
    icon: '🎙️',
    title: '1. Speak the claim',
    text: 'The technician says what they did, in their own words — task, machine ID, readings. Hindi-English mixing is fine.',
  },
  {
    icon: '📷',
    title: '2. Upload evidence',
    text: 'A nameplate/serial photo and a final-condition photo — the two things any technician already has on their phone.',
  },
  {
    icon: '✅',
    title: '3. Get a real decision',
    text: 'Voice, photos, and the procedure checklist are cross-checked field by field. No exact match required — tolerance bands, not vibes.',
  },
];

const DECISIONS = [
  { key: 'verified', label: 'VERIFIED', desc: 'Everything present, consistent, in range. Comes with an evidence score out of 100.' },
  { key: 'need_more_evidence', label: 'NEED_MORE_EVIDENCE', desc: 'Something required is missing — RealityCheck asks one targeted follow-up question.' },
  { key: 'conflict', label: 'CONFLICT_HUMAN_REVIEW', desc: 'A reading is out of spec, or two sources disagree beyond measurement noise. Escalated, not guessed at.' },
];

export default function HomePage() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .listTasks({ limit: 200 })
      .then(({ data }) => {
        const total = data.length;
        const verified = data.filter((t) => t.status === 'verified').length;
        const needMore = data.filter((t) => t.status === 'need_more_evidence').length;
        const conflict = data.filter((t) => t.status === 'conflict').length;
        const scored = data.filter((t) => typeof t.latest_score === 'number');
        const avgScore = scored.length ? Math.round(scored.reduce((s, t) => s + t.latest_score, 0) / scored.length) : null;
        setStats({ total, verified, needMore, conflict, avgScore });
      })
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div className="home">
      <section className="hero">
        <div className="hero-badge">Vocallabs Hackathon Drive · Multimodal Track</div>
        <h1 className="hero-title">
          Don't ask <em>"did you finish?"</em>
          <br />
          Ask <span className="accent">"prove it."</span>
        </h1>
        <p className="hero-sub">
          RealityCheck cross-checks a technician's spoken job claim against photo evidence and a procedure
          checklist — and only calls a job done when the evidence actually agrees.
        </p>
        <div className="hero-actions">
          <Link className="btn primary large" to="/technician">
            🎙️ Start a job (Technician)
          </Link>
          <Link className="btn secondary large" to="/supervisor">
            📋 Open Supervisor Dashboard
          </Link>
        </div>
        <Link className="hero-guide-link" to="/guide">
          New here? Read the guide →
        </Link>
      </section>

      <section className="stats-strip">
        {error && <p className="muted small">Live stats unavailable ({error}) — backend may not be running.</p>}
        {!error && !stats && <p className="muted small">Loading live stats…</p>}
        {stats && (
          <>
            <div className="stat">
              <div className="stat-value">{stats.total}</div>
              <div className="stat-label">jobs logged</div>
            </div>
            <div className="stat">
              <div className="stat-value stat-verified">{stats.verified}</div>
              <div className="stat-label">verified</div>
            </div>
            <div className="stat">
              <div className="stat-value stat-warn">{stats.needMore}</div>
              <div className="stat-label">need more evidence</div>
            </div>
            <div className="stat">
              <div className="stat-value stat-conflict">{stats.conflict}</div>
              <div className="stat-label">flagged for review</div>
            </div>
            <div className="stat">
              <div className="stat-value">{stats.avgScore ?? '—'}</div>
              <div className="stat-label">avg evidence score</div>
            </div>
          </>
        )}
      </section>

      <section className="section-block">
        <h2 className="section-title">How it works</h2>
        <div className="steps-grid">
          {STEPS.map((s) => (
            <div key={s.title} className="step-card">
              <div className="step-icon">{s.icon}</div>
              <h3>{s.title}</h3>
              <p className="muted">{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section-block">
        <h2 className="section-title">Every job ends in one of three decisions</h2>
        <div className="decision-grid">
          {DECISIONS.map((d) => (
            <div key={d.key} className={`decision-card decision-${d.key}`}>
              <span className={`status-pill status-${d.key}`}>{d.label.replace(/_/g, ' ')}</span>
              <p className="muted">{d.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="persona-block">
        <h2 className="section-title">Built for a real technician, not "field workers" in general</h2>
        <p className="muted">
          An AMC (annual maintenance contract) technician servicing split-ACs and RO purifiers for a local service
          franchise. Today he types "job done" into a CRM and gets paid regardless of whether the gas pressure was
          actually checked. RealityCheck closes that gap — one Claude API key, called two structurally different
          ways (text reasoning + vision), genuinely co-operating on a single decision.
        </p>
      </section>
    </div>
  );
}
