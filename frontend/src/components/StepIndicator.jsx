export const TECHNICIAN_STEPS = [
  { key: 'service', label: 'Choose Service' },
  { key: 'claim', label: 'State Claim' },
  { key: 'evidence', label: 'Provide Evidence' },
  { key: 'verify', label: 'Run Verification' },
  { key: 'result', label: 'Review Result' },
];

/**
 * `done` is a per-step array of booleans and `currentIndex` is the step to
 * focus next — both derived by the caller from real app state (task
 * created? claim submitted? required evidence ACTUALLY uploaded?
 * verification ACTUALLY run?). Deliberately per-step rather than a single
 * "everything before N is done" cutoff: nothing stops a technician from
 * running verification before evidence is uploaded, and the indicator
 * must show that honestly (evidence still open) rather than implying it's
 * done just because a later step happened.
 */
export default function StepIndicator({ done = [], currentIndex }) {
  return (
    <ol className="step-indicator" aria-label="Technician workflow progress">
      {TECHNICIAN_STEPS.map((step, i) => {
        const state = done[i] ? 'done' : i === currentIndex ? 'current' : 'upcoming';
        return (
          <li key={step.key} className={`step-indicator-item step-${state}`} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="step-indicator-dot" aria-hidden="true">{state === 'done' ? '✓' : i + 1}</span>
            <span className="step-indicator-label">{step.label}</span>
            {i < TECHNICIAN_STEPS.length - 1 && <span className="step-indicator-connector" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}
