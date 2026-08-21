const LABELS = {
  pending: 'Pending',
  verified: 'Verified',
  need_more_evidence: 'Need More Evidence',
  conflict: 'Conflict — Human Review',
  insufficient_evidence: 'Insufficient Evidence',
};

export default function StatusPill({ status }) {
  return <span className={`status-pill status-${status}`}>{LABELS[status] || status}</span>;
}
