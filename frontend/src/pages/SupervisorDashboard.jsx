import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import StatusPill from '../components/StatusPill.jsx';

const TASK_TYPE_LABELS = {
  'ac-service': 'AC Servicing',
  'ro-service': 'RO / Water Purifier Servicing',
  'fridge-service': 'Refrigerator Servicing',
  'washer-service': 'Washing Machine Servicing',
};

const SUMMARY_CARDS = [
  { key: 'total', label: 'Total Jobs', statuses: null },
  { key: 'verified', label: 'Verified', statuses: ['verified'], tone: 'ok' },
  { key: 'need_more_evidence', label: 'Need More Evidence', statuses: ['need_more_evidence'], tone: 'warn' },
  { key: 'image_unclear', label: 'Image Unclear', statuses: ['image_unclear'], tone: 'warn' },
  { key: 'conflict', label: 'Human Review', statuses: ['conflict'], tone: 'conflict' },
  { key: 'insufficient_evidence', label: 'Insufficient Evidence', statuses: ['insufficient_evidence'], tone: 'insufficient' },
];

// Same decision -> status-pill-key mapping every other page derives locally
// (helpers.js's STATUS_BY_DECISION, mirrored client-side) — the suspicious-
// jobs list gets raw decision strings straight from reports.js, not the
// already-lowercased `status` a task row carries.
const DECISION_TO_STATUS = {
  VERIFIED: 'verified',
  NEED_MORE_EVIDENCE: 'need_more_evidence',
  IMAGE_UNCLEAR: 'image_unclear',
  CONFLICT_HUMAN_REVIEW: 'conflict',
  INSUFFICIENT_EVIDENCE: 'insufficient_evidence',
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function SupervisorDashboard() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [taskTypeFilter, setTaskTypeFilter] = useState('');
  const [availableTaskTypes, setAvailableTaskTypes] = useState([]);

  // Reporting — daily by default, switchable to a custom from/to range.
  // Nothing here is derived from the `tasks` list above: it's a fresh,
  // real query to the backend's date-scoped aggregation (routes/reports.js),
  // not a client-side re-slice of whatever page of tasks happens to be loaded.
  const [reportMode, setReportMode] = useState('daily');
  const [reportDate, setReportDate] = useState(todayIso);
  const [reportFrom, setReportFrom] = useState(todayIso);
  const [reportTo, setReportTo] = useState(todayIso);
  const [report, setReport] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState(null);

  async function loadReport() {
    setReportLoading(true);
    setReportError(null);
    try {
      const params = reportMode === 'daily' ? { date: reportDate } : { from: reportFrom, to: reportTo };
      setReport(await api.getReportSummary(params));
    } catch (err) {
      setReportError(err.message);
    } finally {
      setReportLoading(false);
    }
  }

  useEffect(() => {
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function reportCsvHref() {
    return reportMode === 'daily' ? api.reportCsvUrl({ date: reportDate }) : api.reportCsvUrl({ from: reportFrom, to: reportTo });
  }

  async function load(filter) {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.listTasks(filter ? { task_type: filter } : {});
      setTasks(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(taskTypeFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskTypeFilter]);

  useEffect(() => {
    api
      .listChecklists()
      .then((rows) => setAvailableTaskTypes(rows.map((r) => r.task_type)))
      .catch(() => setAvailableTaskTypes([]));
  }, []);

  // Every count here comes directly from the real tasks array — never a
  // placeholder/invented statistic.
  const counts = useMemo(() => {
    const result = { total: tasks.length };
    for (const card of SUMMARY_CARDS) {
      if (card.statuses) result[card.key] = tasks.filter((t) => card.statuses.includes(t.status)).length;
    }
    return result;
  }, [tasks]);

  return (
    <div className="supervisor-page">
      <div className="summary-card-row">
        {SUMMARY_CARDS.map((c) => (
          <div key={c.key} className={`summary-card${c.tone ? ` summary-card-${c.tone}` : ''}`}>
            <div className="summary-card-value">{counts[c.key] ?? 0}</div>
            <div className="summary-card-label">{c.label}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="task-header">
          <h1>Reports</h1>
          <div className="claim-actions">
            <label className="inline-filter">
              <select value={reportMode} onChange={(e) => setReportMode(e.target.value)}>
                <option value="daily">Daily</option>
                <option value="range">Custom range</option>
              </select>
            </label>
            {reportMode === 'daily' ? (
              <label className="inline-filter">
                Date:
                <input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} />
              </label>
            ) : (
              <>
                <label className="inline-filter">
                  From:
                  <input type="date" value={reportFrom} onChange={(e) => setReportFrom(e.target.value)} />
                </label>
                <label className="inline-filter">
                  To:
                  <input type="date" value={reportTo} onChange={(e) => setReportTo(e.target.value)} />
                </label>
              </>
            )}
            <button className="btn secondary" onClick={loadReport} disabled={reportLoading}>
              {reportLoading ? 'Loading…' : 'Generate report'}
            </button>
            <a className="btn secondary" href={reportCsvHref()}>
              ⬇ Export CSV
            </a>
          </div>
        </div>

        {reportError && <p className="error-text">{reportError}</p>}

        {report && (
          <>
            <div className="report-stat-row">
              <div className="report-stat">
                <div className="report-stat-value">{report.total_jobs}</div>
                <div className="report-stat-label">Total jobs</div>
              </div>
              <div className="report-stat">
                <div className="report-stat-value">{report.by_decision.verified}</div>
                <div className="report-stat-label">Verified</div>
              </div>
              <div className="report-stat">
                <div className="report-stat-value">{report.by_decision.need_more_evidence}</div>
                <div className="report-stat-label">Need more evidence</div>
              </div>
              <div className="report-stat">
                <div className="report-stat-value">{report.by_decision.image_unclear}</div>
                <div className="report-stat-label">Unclear image</div>
              </div>
              <div className="report-stat">
                <div className="report-stat-value">{report.by_decision.conflict}</div>
                <div className="report-stat-label">Human review</div>
              </div>
              <div className="report-stat">
                <div className="report-stat-value">{report.out_of_range_jobs}</div>
                <div className="report-stat-label">Out of range</div>
              </div>
              <div className="report-stat">
                <div className="report-stat-value">{report.average_evidence_score ?? '—'}</div>
                <div className="report-stat-label">Avg evidence score</div>
              </div>
              <div className="report-stat">
                <div className="report-stat-value">{report.suspicious_count}</div>
                <div className="report-stat-label">Suspicious</div>
              </div>
            </div>

            {report.suspicious_jobs.length > 0 && (
              <div className="suspicious-block">
                <h2>Suspicious / requires review</h2>
                <p className="muted small">
                  Flagged for a supervisor to inspect — never an accusation. Click through to see the full evidence
                  and audit trail before drawing any conclusion.
                </p>
                <div className="table-scroll">
                  <table className="task-table">
                    <thead>
                      <tr>
                        <th>Job</th>
                        <th>Service</th>
                        <th>Technician</th>
                        <th>Decision</th>
                        <th>Score</th>
                        <th>Reasons</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {report.suspicious_jobs.map((j) => (
                        <tr key={j.task_id}>
                          <td>Unit {j.unit_id || '—'}</td>
                          <td>{TASK_TYPE_LABELS[j.task_type] || j.task_type}</td>
                          <td>{j.technician || '—'}</td>
                          <td>
                            <StatusPill status={DECISION_TO_STATUS[j.decision] || 'pending'} />
                          </td>
                          <td>{j.evidence_score ?? '—'}</td>
                          <td className="field-message">{j.reasons.join(' · ')}</td>
                          <td>
                            <Link className="btn tiny" to={`/supervisor/tasks/${j.task_id}`}>
                              Inspect
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="card">
        <div className="task-header">
          <h1>Recent jobs</h1>
          <div className="claim-actions">
            <label className="inline-filter">
              Service:
              <select value={taskTypeFilter} onChange={(e) => setTaskTypeFilter(e.target.value)}>
                <option value="">All services</option>
                {availableTaskTypes.map((t) => (
                  <option key={t} value={t}>
                    {TASK_TYPE_LABELS[t] || t}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn secondary" onClick={() => load(taskTypeFilter)} disabled={loading}>
              {loading ? 'Refreshing…' : '↻ Refresh'}
            </button>
            <Link className="btn secondary" to="/supervisor/knowledge">
              📖 Knowledge base
            </Link>
          </div>
        </div>

        {error && <p className="error-text">{error}</p>}

        {!loading && tasks.length === 0 && <p className="muted">No jobs yet — start one from the Technician view.</p>}

        {tasks.length > 0 && (
          <div className="table-scroll">
            <table className="task-table">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Service</th>
                  <th>Technician</th>
                  <th>Status</th>
                  <th>Score</th>
                  <th>Date</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id}>
                    <td>Unit {t.unit_id || '—'}</td>
                    <td>{TASK_TYPE_LABELS[t.task_type] || t.task_type}</td>
                    <td>{t.technician || '—'}</td>
                    <td>
                      <StatusPill status={t.status} />
                    </td>
                    <td>{t.latest_score ?? '—'}</td>
                    <td className="muted small">{t.created_at}</td>
                    <td>
                      <Link className="btn tiny" to={`/supervisor/tasks/${t.id}`}>
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
