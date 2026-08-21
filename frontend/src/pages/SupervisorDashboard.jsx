import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import StatusPill from '../components/StatusPill.jsx';

export default function SupervisorDashboard() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.listTasks();
      setTasks(data);
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
      <div className="task-header">
        <h1>Supervisor dashboard</h1>
        <button className="btn secondary" onClick={load} disabled={loading}>
          {loading ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </div>

      {error && <p className="error-text">{error}</p>}

      {!loading && tasks.length === 0 && <p className="muted">No jobs yet — start one from the Technician view.</p>}

      {tasks.length > 0 && (
        <div className="table-scroll">
          <table className="task-table">
            <thead>
              <tr>
                <th>Unit</th>
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
