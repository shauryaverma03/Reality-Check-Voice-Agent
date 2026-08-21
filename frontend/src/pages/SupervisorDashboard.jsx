import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import StatusPill from '../components/StatusPill.jsx';

const TASK_TYPE_LABELS = {
  'ac-service': 'AC Servicing',
  'ro-service': 'RO / Water Purifier Servicing',
  'fridge-service': 'Refrigerator Servicing',
  'washer-service': 'Washing Machine Servicing',
};

export default function SupervisorDashboard() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [taskTypeFilter, setTaskTypeFilter] = useState('');
  const [availableTaskTypes, setAvailableTaskTypes] = useState([]);

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

  return (
    <div className="card">
      <div className="task-header">
        <h1>Supervisor dashboard</h1>
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
                <th>Unit</th>
                <th>Service</th>
                <th>Technician</th>
                <th>Status</th>
                <th>Evidence score</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id}>
                  <td>{t.unit_id || '—'}</td>
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
  );
}
