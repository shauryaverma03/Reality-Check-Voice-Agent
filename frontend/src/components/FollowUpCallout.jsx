// The targeted follow-up prompt for NEED_MORE_EVIDENCE / IMAGE_UNCLEAR /
// INSUFFICIENT_IMAGE_EVIDENCE — the question text always comes straight
// from the backend's follow_up_question (the first problem field, in
// checklist order); this component only decides which button to show and
// where it scrolls, and how to title itself, based on that same field's
// real status/type. Never invents a question of its own.
const PROBLEM_STATUSES = new Set(['missing', 'unclear', 'content_unverified']);

const TITLE_BY_STATUS = {
  missing: 'One thing is still missing',
  unclear: 'This image needs to be replaced',
  content_unverified: "This image hasn't been verified yet",
};

export default function FollowUpCallout({ question, fields, onProvideEvidence, onUpdateClaim }) {
  const problemField = fields.find((f) => PROBLEM_STATUSES.has(f.status));
  const isEvidence = problemField?.type === 'photo' || problemField?.type === 'document';

  return (
    <div className="followup-callout">
      <span className="followup-callout-icon" aria-hidden="true">⚠</span>
      <div className="followup-callout-body">
        <div className="followup-callout-title">{TITLE_BY_STATUS[problemField?.status] || 'One thing is still missing'}</div>
        <p className="followup-callout-question">{question}</p>
        <button type="button" className="btn primary" onClick={isEvidence ? onProvideEvidence : onUpdateClaim}>
          {isEvidence ? 'Provide Evidence ↓' : 'Update Claim ↑'}
        </button>
      </div>
    </div>
  );
}
