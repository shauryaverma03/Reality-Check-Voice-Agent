import { useEffect, useRef, useState } from 'react';
import { PALETTES, PALETTE_LABELS, resolveTheme, transitionToTheme } from '../theme.js';

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

  function setMode(nextMode) {
    setState((s) => ({ ...s, mode: nextMode }));
    transitionToTheme({ mode: nextMode, palette });
  }

  function setPalette(nextPalette) {
    setState((s) => ({ ...s, palette: nextPalette }));
    transitionToTheme({ mode, palette: nextPalette });
    setOpen(false);
  }

  return (
    <div className="theme-switcher">
      <button
        type="button"
        className="theme-toggle-btn"
        onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')}
        aria-label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        title={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {mode === 'dark' ? '🌙' : '☀️'}
      </button>
      <div className="palette-picker" ref={menuRef}>
        <button
          type="button"
          className="theme-toggle-btn"
          onClick={() => setOpen((o) => !o)}
          aria-label="Choose color palette"
          aria-haspopup="menu"
          aria-expanded={open}
          title="Choose color palette"
        >
          🎨
        </button>
        {open && (
          <div className="palette-menu" role="menu">
            {PALETTES.map((p) => (
              <button
                key={p}
                type="button"
                role="menuitemradio"
                aria-checked={palette === p}
                className={`palette-option${palette === p ? ' active' : ''}`}
                onClick={() => setPalette(p)}
              >
                <span className={`palette-swatch palette-swatch-${p}`} aria-hidden="true" />
                {PALETTE_LABELS[p]}
                {palette === p && <span className="palette-check" aria-hidden="true">✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
