const STATUS_LABELS = {
  ok: 'OK',
  borderline: 'Borderline',
  missing: 'Missing',
  contradiction: 'Contradiction',
  out_of_range: 'Out of range',
  insufficient_evidence: 'Insufficient evidence',
};

export default function FieldBreakdown({ fields }) {
  if (!fields || fields.length === 0) {
    return <p className="muted">No verification run yet.</p>;
  }

  return (
    <div className="table-scroll">
      <table className="field-table">
        <thead>
          <tr>
            <th>Field</th>
            <th>Status</th>
            <th>Sources</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((f) => (
            <tr key={f.key} className={`field-row field-${f.status}`}>
              <td className="field-key">{f.key}</td>
              <td>
                <span className={`field-status field-status-${f.status}`}>
                  {STATUS_LABELS[f.status] || f.status}
                </span>
              </td>
              <td>
                {f.sources && f.sources.length > 0 ? (
                  f.sources.map((s, i) => (
                    <div key={i} className="source-chip">
                      <strong>{s.origin}</strong>: {String(s.value)}
                    </div>
                  ))
                ) : (
                  <span className="muted">—</span>
                )}
                {f.citation && (
                  <div className="citation-chip" title={f.citation.snippet}>
                    📖 {f.citation.document_title}
                    {typeof f.citation.score === 'number' ? ` (match ${Math.round(f.citation.score * 100)}%)` : ''}
                  </div>
                )}
              </td>
              <td className="field-message">{f.message || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
