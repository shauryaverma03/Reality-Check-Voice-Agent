import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, API_BASE_URL } from '../api.js';
import StatusPill from '../components/StatusPill.jsx';
import FieldBreakdown from '../components/FieldBreakdown.jsx';

export default function TaskDetail() {
  const { id } = useParams();
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [showTrail, setShowTrail] = useState(false);

  async function load() {
    setError(null);
    try {
      setReport(await api.getReport(id));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (error) {
    return (
      <div className="card">
        <p className="error-text">{error}</p>
        <Link className="btn secondary" to="/supervisor">
          ← Back to dashboard
        </Link>
      </div>
    );
  }

  if (!report) return <div className="card">Loading…</div>;

  const { task, claim, evidence, verification, agent_runs } = report;

  return (
    <div className="card">
      <Link className="back-link" to="/supervisor">
        ← Back to dashboard
      </Link>

      <div className="task-header">
        <div>
          <h1>Job — Unit {task.unit_id || '—'}</h1>
          <p className="muted">
            Technician: {task.technician || '—'} · Task ID: {task.id} · Created {task.created_at}
          </p>
        </div>
        <StatusPill status={task.status} />
      </div>

      <section className="section">
        <h2>Voice claim</h2>
        {claim ? (
          <>
            <blockquote className="claim-quote">“{claim.raw_text}”</blockquote>
            <p className="muted small">
              Extracted ({claim.extraction_source}):{' '}
              {Object.entries(claim.extracted)
                .map(([k, v]) => `${k}=${v}`)
                .join(', ') || 'nothing extracted'}
            </p>
          </>
        ) : (
          <p className="muted">No claim submitted yet.</p>
        )}
      </section>

      <section className="section">
        <h2>Evidence photos</h2>
        {evidence.length === 0 && <p className="muted">No evidence uploaded yet.</p>}
        <div className="evidence-grid">
          {evidence.map((e) => (
            <div key={e.id} className="evidence-item">
              <img src={`${API_BASE_URL}/${e.file_path}`} alt={e.role} />
              <div className="evidence-meta">
                <strong>{e.role}</strong>
                <span className="muted small">
                  {Object.entries(e.extracted)
                    .map(([k, v]) => `${k}=${v}`)
                    .join(', ') || `no fields read (${e.extraction_source})`}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>Verification</h2>
        {verification ? (
          <div className={`status-card status-card-${verification.decision}`}>
            <div className="status-card-heading">
              <StatusPill
                status={
                  { VERIFIED: 'verified', NEED_MORE_EVIDENCE: 'need_more_evidence', CONFLICT_HUMAN_REVIEW: 'conflict' }[
                    verification.decision
                  ]
                }
              />
              <span className="score">Evidence score: {verification.evidence_score}/100</span>
            </div>
            {verification.follow_up_question && <p className="follow-up">Follow-up: {verification.follow_up_question}</p>}
            <FieldBreakdown fields={verification.fields} />
          </div>
        ) : (
          <p className="muted">Not verified yet.</p>
        )}
      </section>

      <section className="section">
        <button className="btn secondary" onClick={() => setShowTrail((s) => !s)}>
          {showTrail ? 'Hide' : 'Show'} agent run log ({agent_runs.length} steps)
        </button>
        {showTrail && (
          <div className="table-scroll">
            <table className="agent-run-table">
              <thead>
                <tr>
                  <th>Step</th>
                  <th>Input</th>
                  <th>Output</th>
                  <th>At</th>
                </tr>
              </thead>
              <tbody>
                {agent_runs.map((r) => (
                  <tr key={r.id}>
                    <td>{r.step}</td>
                    <td>
                      <pre>{JSON.stringify(r.input, null, 2)}</pre>
                    </td>
                    <td>
                      <pre>{JSON.stringify(r.output, null, 2)}</pre>
                    </td>
                    <td className="muted small">{r.created_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
