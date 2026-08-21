import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

const TASK_TYPE_LABELS = {
  'ac-service': 'AC Servicing',
  'ro-service': 'RO / Water Purifier Servicing',
  'fridge-service': 'Refrigerator Servicing',
  'washer-service': 'Washing Machine Servicing',
};

// Supervisor-only page: uploads REFERENCE knowledge (manufacturer manuals,
// SOPs, spec sheets) — deliberately a completely separate flow from the
// technician's evidence uploads on the Technician page. A doc uploaded here
// is retrieved by the verifier via RAG; it is never attached to a task and
// never counts as evidence a technician submitted.
export default function KnowledgePage() {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [title, setTitle] = useState('');
  const [taskType, setTaskType] = useState('');
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setDocs(await api.listKnowledgeDocs());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleUpload(e) {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setError(null);
    setMessage(null);
    try {
      const doc = await api.uploadKnowledgeDoc({ title, taskType, file });
      setMessage(`Indexed "${doc.title}" — ${doc.chunk_count} chunk${doc.chunk_count === 1 ? '' : 's'}.`);
      setTitle('');
      setFile(null);
      e.target.reset();
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="card">
      <Link className="back-link" to="/supervisor">
        ← Back to dashboard
      </Link>
      <h1>Knowledge base</h1>
      <p className="muted">
        Manufacturer manuals, SOPs, and spec sheets — retrieved during verification to back a checklist reading with a
        real citation. This is reference material, not technician evidence: it's never attached to a task.
      </p>

      <section className="section">
        <h2>Upload a reference document</h2>
        <form onSubmit={handleUpload} className="form">
          <label>
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Samsung RO Service Manual" />
          </label>
          <label>
            Applies to
            <select value={taskType} onChange={(e) => setTaskType(e.target.value)}>
              <option value="">General (all services)</option>
              {Object.entries(TASK_TYPE_LABELS).map(([t, label]) => (
                <option key={t} value={t}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            File (PDF or .txt)
            <input type="file" accept="application/pdf,.txt" onChange={(e) => setFile(e.target.files[0] || null)} required />
          </label>
          {error && <p className="error-text">{error}</p>}
          {message && <p className="muted small">{message}</p>}
          <button type="submit" className="btn primary" disabled={uploading || !file}>
            {uploading ? 'Uploading…' : 'Upload & index'}
          </button>
        </form>
      </section>

      <section className="section">
        <h2>Indexed documents</h2>
        {loading && <p className="muted">Loading…</p>}
        {!loading && docs.length === 0 && <p className="muted">No reference documents uploaded yet.</p>}
        {docs.length > 0 && (
          <div className="table-scroll">
            <table className="task-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Applies to</th>
                  <th>Chunks</th>
                  <th>Uploaded</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id}>
                    <td>{d.title}</td>
                    <td>{d.task_type ? TASK_TYPE_LABELS[d.task_type] || d.task_type : 'General (all services)'}</td>
                    <td>{d.chunk_count}</td>
                    <td className="muted small">{d.created_at}</td>
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
