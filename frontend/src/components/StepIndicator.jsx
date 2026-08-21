export const TECHNICIAN_STEPS = [
  { key: 'service', label: 'Choose Service' },
  { key: 'claim', label: 'State Claim' },
  { key: 'evidence', label: 'Provide Evidence' },
  { key: 'verify', label: 'Run Verification' },
  { key: 'result', label: 'Review Result' },
];

/**
 * currentIndex is derived from real app state by the caller (task created?
 * claim submitted? required evidence uploaded? verification run?) — never a
 * fake/simulated progress value.
 */
export default function StepIndicator({ currentIndex }) {
  return (
    <ol className="step-indicator" aria-label="Technician workflow progress">
      {TECHNICIAN_STEPS.map((step, i) => {
        const state = i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'upcoming';
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
