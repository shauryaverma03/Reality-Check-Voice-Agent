// The targeted follow-up prompt for NEED_MORE_EVIDENCE — the question text
// always comes straight from the backend's follow_up_question (the first
// missing required field, in checklist order); this component only decides
// which button to show and where it scrolls, based on that same field's
// real `type`. Never invents a question of its own.
export default function FollowUpCallout({ question, fields, onProvideEvidence, onUpdateClaim }) {
  const firstMissing = fields.find((f) => f.status === 'missing');
  const isEvidence = firstMissing?.type === 'photo' || firstMissing?.type === 'document';

  return (
    <div className="followup-callout">
      <span className="followup-callout-icon" aria-hidden="true">⚠</span>
      <div className="followup-callout-body">
        <div className="followup-callout-title">One thing is still missing</div>
        <p className="followup-callout-question">{question}</p>
        <button type="button" className="btn primary" onClick={isEvidence ? onProvideEvidence : onUpdateClaim}>
          {isEvidence ? 'Provide Evidence ↓' : 'Update Claim ↑'}
        </button>
      </div>
    </div>
  );
}
