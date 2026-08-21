import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

const TASK_TYPE_LABELS = {
  'ac-service': 'AC Servicing',
  'ro-service': 'RO / Water Purifier Servicing',
  'fridge-service': 'Refrigerator Servicing',
  'washer-service': 'Washing Machine Servicing',
};
const SERVICE_ORDER = ['ac-service', 'ro-service', 'fridge-service', 'washer-service'];

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

  // Real counts, grouped from the actual documents list — never invented.
  const perService = useMemo(() => {
    const groups = {};
    for (const t of SERVICE_ORDER) groups[t] = { pdf: 0, web: 0 };
    for (const d of docs) {
      if (!d.task_type || !groups[d.task_type]) continue;
      if (d.source_type === 'web') groups[d.task_type].web += 1;
      else groups[d.task_type].pdf += 1;
    }
    return groups;
  }, [docs]);

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
        <h2>Coverage by service</h2>
        <div className="knowledge-summary-grid">
          {SERVICE_ORDER.map((t) => (
            <div key={t} className="knowledge-summary-card">
              <div className="knowledge-summary-label">{TASK_TYPE_LABELS[t]}</div>
              <div className="knowledge-summary-counts">
                <span>{perService[t].pdf} PDF{perService[t].pdf === 1 ? '' : 's'}</span>
                <span>{perService[t].web} web source{perService[t].web === 1 ? '' : 's'}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

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
          <div className="source-card-grid">
            {docs.map((d) => (
              <div key={d.id} className="source-card">
                <div className="source-card-top">
                  <span className="source-type-badge">{d.source_type === 'web' ? 'Web' : 'PDF'}</span>
                  <span className="muted small">{d.chunk_count} chunk{d.chunk_count === 1 ? '' : 's'}</span>
                </div>
                <div className="source-card-title">{d.title}</div>
                <div className="source-card-meta">
                  <span>{d.task_type ? TASK_TYPE_LABELS[d.task_type] || d.task_type : 'General (all services)'}</span>
                  {(d.manufacturer || d.model) && <span>{[d.manufacturer, d.model].filter(Boolean).join(' ')}</span>}
                  <span className="muted small">Added {d.created_at}</span>
                </div>
                {d.source_url && (
                  <a href={d.source_url} target="_blank" rel="noreferrer" className="source-card-link">
                    Open source ↗
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
