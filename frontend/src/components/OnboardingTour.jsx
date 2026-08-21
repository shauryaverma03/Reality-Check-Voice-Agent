import { useEffect, useLayoutEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { TOUR_STEPS, markTourCompleted } from '../tour.js';

const PADDING = 8;

// Self-built spotlight tour — no external library. Navigates between routes
// as needed (a couple of steps live on /technician), waits a tick for the
// DOM to settle, then measures the real target element's rect so the
// spotlight always tracks the actual rendered UI rather than a guessed
// position.
export default function OnboardingTour({ active, onClose }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState(null);
  const location = useLocation();
  const navigate = useNavigate();

  const step = TOUR_STEPS[stepIndex];
  const isLast = stepIndex === TOUR_STEPS.length - 1;

  useEffect(() => {
    if (!active) return;
    setStepIndex(0);
  }, [active]);

  useEffect(() => {
    if (!active || !step) return;
    if (step.path && location.pathname !== step.path) {
      navigate(step.path);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, stepIndex]);

  useLayoutEffect(() => {
    if (!active || !step) {
      setRect(null);
      return;
    }
    if (!step.selector) {
      setRect(null);
      return;
    }
    if (step.path && location.pathname !== step.path) return; // still navigating

    function measure() {
      const el = document.querySelector(step.selector);
      if (el) {
        const r = el.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } else {
        setRect(null);
      }
    }
    const raf = requestAnimationFrame(() => requestAnimationFrame(measure));
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [active, stepIndex, location.pathname, step]);

  if (!active || !step) return null;

  function finish() {
    markTourCompleted();
    onClose();
  }

  function next() {
    if (isLast) {
      finish();
    } else {
      setStepIndex((i) => i + 1);
    }
  }

  function back() {
    setStepIndex((i) => Math.max(0, i - 1));
  }

  const spotlightStyle = rect
    ? {
        top: rect.top - PADDING,
        left: rect.left - PADDING,
        width: rect.width + PADDING * 2,
        height: rect.height + PADDING * 2,
      }
    : null;

  // Tooltip placement: below the spotlight if there's room, else above; a
  // centered card when there's no target at all.
  let cardStyle = {};
  let cardPlacement = 'center';
  if (rect) {
    const viewportH = window.innerHeight;
    const spaceBelow = viewportH - (rect.top + rect.height);
    if (spaceBelow > 200) {
      cardStyle = { top: rect.top + rect.height + PADDING * 2 + 8, left: Math.min(Math.max(rect.left, 16), window.innerWidth - 336) };
      cardPlacement = 'below';
    } else {
      cardStyle = { top: Math.max(rect.top - PADDING * 2 - 8, 16), left: Math.min(Math.max(rect.left, 16), window.innerWidth - 336), transform: 'translateY(-100%)' };
      cardPlacement = 'above';
    }
  }

  return (
    <div className="tour-root" role="dialog" aria-modal="true" aria-label="Onboarding tour">
      <div className="tour-backdrop" onClick={finish} />
      {spotlightStyle && <div className="tour-spotlight" style={spotlightStyle} />}
      <div className={`tour-card tour-card-${cardPlacement}`} style={cardStyle}>
        <div className="tour-card-step">
          Step {stepIndex + 1} of {TOUR_STEPS.length}
        </div>
        <h3 className="tour-card-title">{step.title}</h3>
        <p className="tour-card-body">{step.body}</p>
        <div className="tour-card-actions">
          <button type="button" className="btn tiny secondary" onClick={finish}>
            Skip
          </button>
          <div className="tour-card-nav">
            <button type="button" className="btn tiny secondary" onClick={back} disabled={stepIndex === 0}>
              Back
            </button>
            <button type="button" className="btn tiny primary" onClick={next}>
              {isLast ? 'Finish' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
