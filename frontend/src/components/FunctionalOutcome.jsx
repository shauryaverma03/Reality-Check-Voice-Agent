// The compliance-vs-function panel. Renders ONLY what the backend's
// functional_verification block actually says (see verifier.js's
// evaluateFunctionalOutcome) — it never derives, softens, or upgrades a
// status on the client. Its whole job is to stop a green "VERIFIED" badge
// from being read as "the appliance works", which is a different and much
// stronger claim than the checklist alone can support.

const STATUS_META = {
  demonstrated: { icon: '✓', label: 'Function demonstrated', tone: 'ok' },
  partially_demonstrated: { icon: '◐', label: 'Function partly demonstrated', tone: 'warn' },
  not_demonstrated: { icon: '!', label: 'Function NOT demonstrated', tone: 'danger' },
  not_applicable: { icon: '–', label: 'No functional test defined', tone: 'neutral' },
};

const CHECK_META = {
  demonstrated: { icon: '✓', tone: 'ok', label: 'Measured' },
  asserted: { icon: '~', tone: 'warn', label: 'Self-reported' },
  not_provided: { icon: '○', tone: 'neutral', label: 'Not provided' },
  failed: { icon: '✕', tone: 'danger', label: 'Outside range' },
};

export default function FunctionalOutcome({ functional, scope }) {
  // Older verification rows (written before this split existed) carry null —
  // shown as "never asked", never as a pass.
  if (!functional) {
    return (
      <div className="functional-panel functional-neutral">
        <div className="functional-head">
          <span className="functional-badge functional-badge-neutral">–</span>
          <div>
            <div className="functional-title">Functional outcome not assessed</div>
            <p className="functional-summary">
              This result predates post-repair functional checking, so it only tells you the evidence was consistent
              with the checklist — not whether the unit is working.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const meta = STATUS_META[functional.status] || STATUS_META.not_applicable;

  return (
    <div className={`functional-panel functional-${meta.tone}`}>
      <div className="functional-head">
        <span className={`functional-badge functional-badge-${meta.tone}`} aria-hidden="true">{meta.icon}</span>
        <div>
          <div className="functional-title">{meta.label}</div>
          <p className="functional-summary">{functional.summary}</p>
        </div>
      </div>

      {functional.checks && functional.checks.length > 0 && (
        <ul className="functional-checks">
          {functional.checks.map((c) => {
            const cm = CHECK_META[c.status] || CHECK_META.not_provided;
            return (
              <li key={c.key} className={`functional-check functional-check-${cm.tone}`}>
                <span className="functional-check-icon" aria-hidden="true">{cm.icon}</span>
                <div className="functional-check-body">
                  <div className="functional-check-label">
                    {c.label}
                    <span className={`functional-strength functional-strength-${cm.tone}`}>{cm.label}</span>
                  </div>
                  <div className="functional-check-message">{c.message}</div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {scope && (
        <p className="functional-scope">
          <strong>What this result actually proves:</strong> {scope}
        </p>
      )}
    </div>
  );
}
