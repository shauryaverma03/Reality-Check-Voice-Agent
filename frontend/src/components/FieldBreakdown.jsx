const STATUS_LABELS = {
  ok: 'OK',
  borderline: 'Borderline',
  missing: 'Missing',
  contradiction: 'Contradiction',
  out_of_range: 'Out of range',
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
              </td>
              <td className="field-message">{f.message || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
