import { citationLabel } from '../citations.js';

const STATUS_LABELS = {
  ok: 'OK',
  borderline: 'Borderline',
  missing: 'Missing',
  contradiction: 'Contradiction',
  out_of_range: 'Out of range',
  insufficient_evidence: 'Insufficient evidence',
  unclear: 'Image unclear',
  content_unverified: 'Content not verified',
};

// A source's `origin` is a stable internal token (see verifier.js) — shown
// here in plain language instead. Anything not in this map (an evidence
// role like "serial_photo") is already a real, human-readable label as-is.
const ORIGIN_LABELS = {
  job_context: 'Job record',
  voice: 'Claim',
};

function originLabel(origin) {
  return ORIGIN_LABELS[origin] || origin;
}

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
                {f.machineMismatch && <span className="field-status field-status-mismatch">Machine ID Mismatch</span>}
                {f.mismatch && !f.machineMismatch && <span className="field-status field-status-mismatch">Claim ≠ Evidence</span>}
              </td>
              <td>
                {f.sources && f.sources.length > 0 ? (
                  f.sources.map((s, i) => (
                    <div key={i} className="source-chip">
                      <strong>{originLabel(s.origin)}</strong>: {String(s.value)}
                    </div>
                  ))
                ) : (
                  <span className="muted">—</span>
                )}
                {f.citation && (
                  <div className="citation-chip" title={f.citation.snippet}>
                    📖 {citationLabel(f.citation)}
                    {typeof f.citation.score === 'number' ? ` (match ${Math.round(f.citation.score * 100)}%)` : ''}
                  </div>
                )}
                {f.conflictingReferences && (
                  <div className="citation-chip citation-conflict">
                    ⚠️ Reference sources disagree:
                    {f.conflictingReferences.map((ref, i) => (
                      <div key={i} title={ref.snippet}>
                        📖 {citationLabel(ref)}
                      </div>
                    ))}
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
