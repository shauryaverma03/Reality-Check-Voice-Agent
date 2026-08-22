import { useEffect, useRef, useState } from 'react';
import { PALETTES, PALETTE_LABELS, resolveTheme, transitionToTheme } from '../theme.js';

/** Click coordinates, used as the origin of the circular theme reveal so the
 * new theme visibly spreads out from the control the user actually pressed.
 * Falls back to the element's own centre for keyboard activation, where a
 * real pointer position doesn't exist. */
function originFromEvent(e) {
  if (e.clientX || e.clientY) return { x: e.clientX, y: e.clientY };
  const r = e.currentTarget.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

export default function ThemeSwitcher() {
  const [{ mode, palette }, setState] = useState(resolveTheme);
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onDocClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function toggleMode(e) {
    const nextMode = mode === 'dark' ? 'light' : 'dark';
    setState((s) => ({ ...s, mode: nextMode }));
    transitionToTheme({ mode: nextMode, palette }, { origin: originFromEvent(e) });
  }

  function setPalette(e, nextPalette) {
    const origin = originFromEvent(e);
    setState((s) => ({ ...s, palette: nextPalette }));
    transitionToTheme({ mode, palette: nextPalette }, { origin });
    setOpen(false);
  }

  const isDark = mode === 'dark';

  return (
    <div className="theme-switcher">
      {/* A real switch, not two loose emoji: the track shows both
          destinations and the thumb slides between them, so the current
          state is readable at a glance instead of having to infer it from
          which single icon happens to be showing. */}
      <button
        type="button"
        className={`mode-switch${isDark ? ' is-dark' : ''}`}
        onClick={toggleMode}
        role="switch"
        aria-checked={isDark}
        aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        <span className="mode-switch-track">
          <span className="mode-switch-icon mode-switch-sun" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <circle cx="12" cy="12" r="4.2" />
              <path d="M12 2.4v2.2M12 19.4v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.4 12h2.2M19.4 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
            </svg>
          </span>
          <span className="mode-switch-icon mode-switch-moon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.4 8.4 0 1 0 10.2 10.2Z" />
            </svg>
          </span>
          <span className="mode-switch-thumb" aria-hidden="true" />
        </span>
      </button>

      <div className="palette-picker" ref={menuRef}>
        <button
          type="button"
          className={`palette-trigger${open ? ' is-open' : ''}`}
          onClick={() => setOpen((o) => !o)}
          aria-label="Choose color palette"
          aria-haspopup="menu"
          aria-expanded={open}
          title="Choose color palette"
        >
          <span className={`palette-swatch palette-swatch-${palette}`} aria-hidden="true" />
          <svg className="palette-chevron" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        {open && (
          <div className="palette-menu" role="menu">
            <div className="palette-menu-title">Color palette</div>
            {PALETTES.map((p) => (
              <button
                key={p}
                type="button"
                role="menuitemradio"
                aria-checked={palette === p}
                className={`palette-option${palette === p ? ' active' : ''}`}
                onClick={(e) => setPalette(e, p)}
              >
                <span className={`palette-swatch palette-swatch-${p}`} aria-hidden="true" />
                <span className="palette-option-label">{PALETTE_LABELS[p]}</span>
                {palette === p && <span className="palette-check" aria-hidden="true">✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
