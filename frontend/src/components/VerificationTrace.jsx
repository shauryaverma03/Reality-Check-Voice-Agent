import { citationLabel } from '../citations.js';

const DECISION_META = {
  VERIFIED: { icon: '✓', label: 'VERIFIED' },
  NEED_MORE_EVIDENCE: { icon: '⚠', label: 'NEED MORE EVIDENCE' },
  CONFLICT_HUMAN_REVIEW: { icon: '⚠', label: 'CONFLICT — HUMAN REVIEW' },
  INSUFFICIENT_EVIDENCE: { icon: '?', label: 'INSUFFICIENT EVIDENCE' },
};

function verificationSummary(verification) {
  if (!verification) return null;
  const bad = verification.fields.filter((f) => f.status === 'contradiction' || f.status === 'out_of_range');
  const missing = verification.fields.filter((f) => f.status === 'missing');
  const insufficient = verification.fields.filter((f) => f.status === 'insufficient_evidence');
  if (verification.decision === 'VERIFIED') return { ok: true, text: 'Checklist requirements satisfied.' };
  if (bad.length > 0) return { ok: false, text: `${bad.length} field${bad.length > 1 ? 's' : ''} contradicted or fell out of range.` };
  if (insufficient.length > 0) return { ok: false, text: `${insufficient.length} field${insufficient.length > 1 ? 's' : ''} had no supporting reference found.` };
  if (missing.length > 0) return { ok: false, text: `${missing.length} required field${missing.length > 1 ? 's' : ''} still missing.` };
  return { ok: true, text: 'Checklist requirements satisfied.' };
}

/**
 * "How RealityCheck decided" — a step-by-step reconstruction of the actual
 * verification pipeline, built entirely from real data already returned by
 * the backend (claim text, evidence upload state, citations, per-field
 * verification results). Nothing here is invented or simulated.
 */
export default function VerificationTrace({ claimRawText, evidenceFields, uploaded, verification }) {
  if (!verification) return null;

  const meta = DECISION_META[verification.decision] || { icon: '•', label: verification.decision };
  const summary = verificationSummary(verification);
  const neededReference = verification.fields.some((f) => f.citation || f.status === 'insufficient_evidence' || f.conflictingReferences);
  const citations = verification.citations || [];

  return (
    <div className="trace">
      <h3 className="trace-title">How RealityCheck decided</h3>

      <div className="trace-step">
        <div className="trace-step-label">Technician claim</div>
        <blockquote className="trace-claim">{claimRawText ? `“${claimRawText}”` : '(no claim submitted)'}</blockquote>
      </div>
      <div className="trace-arrow" aria-hidden="true">↓</div>

      <div className="trace-step">
        <div className="trace-step-label">Evidence</div>
        <ul className="trace-list">
          {evidenceFields.map((f) => (
            <li key={f.key} className={uploaded[f.key] ? 'trace-ok' : f.required ? 'trace-bad' : 'trace-neutral'}>
              {uploaded[f.key] ? '✓' : f.required ? '✗' : '—'} {f.label}
            </li>
          ))}
        </ul>
      </div>
      <div className="trace-arrow" aria-hidden="true">↓</div>

      {neededReference && (
        <>
          <div className="trace-step">
            <div className="trace-step-label">Reference knowledge</div>
            {citations.length > 0 ? (
              <ul className="trace-list">
                {citations.map((c, i) => (
                  <li key={i} className={c.conflict ? 'trace-bad' : 'trace-ok'}>
                    {c.conflict ? '⚠' : '✓'} {citationLabel(c)}
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="trace-list">
                <li className="trace-bad">✗ No trustworthy reference documentation found</li>
              </ul>
            )}
          </div>
          <div className="trace-arrow" aria-hidden="true">↓</div>

          <div className="trace-step">
            <div className="trace-step-label">RAG retrieval</div>
            <ul className="trace-list">
              <li className={citations.length > 0 ? 'trace-ok' : 'trace-bad'}>
                {citations.length > 0 ? '✓ Relevant technical reference found' : '✗ No relevant technical reference found'}
              </li>
            </ul>
          </div>
          <div className="trace-arrow" aria-hidden="true">↓</div>
        </>
      )}

      <div className="trace-step">
        <div className="trace-step-label">Verification</div>
        <ul className="trace-list">
          <li className={summary.ok ? 'trace-ok' : 'trace-bad'}>{summary.ok ? '✓' : '✗'} {summary.text}</li>
        </ul>
      </div>
      <div className="trace-arrow" aria-hidden="true">↓</div>

      <div className={`trace-final trace-final-${verification.decision}`}>
        <span className="trace-final-label">FINAL RESULT</span>
        <span className="trace-final-badge">{meta.icon} {meta.label}</span>
      </div>
    </div>
  );
}
