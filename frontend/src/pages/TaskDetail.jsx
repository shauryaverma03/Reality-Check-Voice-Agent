import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, API_BASE_URL } from '../api.js';
import StatusPill from '../components/StatusPill.jsx';
import FieldBreakdown from '../components/FieldBreakdown.jsx';
import FunctionalOutcome from '../components/FunctionalOutcome.jsx';
import { citationLabel, citationEquipment } from '../citations.js';

const TASK_TYPE_LABELS = {
  'ac-service': 'AC Servicing',
  'ro-service': 'RO / Water Purifier Servicing',
  'fridge-service': 'Refrigerator Servicing',
  'washer-service': 'Washing Machine Servicing',
};

const DECISION_TO_STATUS = {
  VERIFIED: 'verified',
  NEED_MORE_EVIDENCE: 'need_more_evidence',
  IMAGE_UNCLEAR: 'image_unclear',
  INSUFFICIENT_IMAGE_EVIDENCE: 'insufficient_image_evidence',
  CONFLICT_HUMAN_REVIEW: 'conflict',
  INSUFFICIENT_EVIDENCE: 'insufficient_evidence',
};

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
            {TASK_TYPE_LABELS[task.task_type] || task.task_type} · Technician: {task.technician || '—'} · Task ID:{' '}
            {task.id} · Created {task.created_at}
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
        <h2>Technician evidence</h2>
        <p className="muted small">Photos and documents submitted by the technician for this job — never treated as automatically trustworthy on their own.</p>
        {evidence.length === 0 && <p className="muted">No evidence uploaded yet.</p>}
        <div className="evidence-grid">
          {evidence.map((e) => (
            <div key={e.id} className="evidence-item">
              {e.mime_type?.startsWith('image/') ? (
                <img src={`${API_BASE_URL}/${e.file_path}`} alt={e.role} />
              ) : (
                <div className="evidence-doc-icon">📄</div>
              )}
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
              <StatusPill status={DECISION_TO_STATUS[verification.decision]} />
              <span className="score">Evidence score: {verification.evidence_score}/100</span>
            </div>
            {verification.follow_up_question && (
              <p className="follow-up">
                {verification.decision === 'INSUFFICIENT_EVIDENCE' ? 'Why: ' : 'Follow-up: '}
                {verification.follow_up_question}
              </p>
            )}
            <FunctionalOutcome
              functional={verification.functional_verification}
              scope={verification.verification_scope}
            />

            <FieldBreakdown fields={verification.fields} />
            {verification.citations && verification.citations.length > 0 && (
              <div className="citations-block">
                <h3>Reference knowledge used</h3>
                <p className="muted small">Retrieved from the supervisor-uploaded knowledge base — never a technician submission.</p>
                <ul>
                  {verification.citations.map((c, i) => (
                    <li key={i} className={c.conflict ? 'citation-conflict' : undefined}>
                      {c.conflict && <span className="muted small">⚠️ disagrees with another source — </span>}
                      📖 <strong>{citationLabel(c)}</strong> — field <code>{c.field_key}</code>
                      <div className="muted small">
                        {c.source_type === 'web' ? 'Web' : 'PDF'}
                        {citationEquipment(c) ? ` · ${citationEquipment(c)}` : ''}
                        {typeof c.score === 'number' ? ` · match ${Math.round(c.score * 100)}%` : ''}
                      </div>
                      {c.url && (
                        <div>
                          <a href={c.url} target="_blank" rel="noreferrer" className="muted small">
                            {c.url}
                          </a>
                        </div>
                      )}
                      <div className="muted small">“{c.snippet}”</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
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
