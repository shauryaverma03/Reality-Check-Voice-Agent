// Theme engine — light/dark mode + 3 color palettes (blue/graphite/teal),
// persisted to localStorage, with a smooth bottom-up "rise" transition on
// manual switches. No animation library — plain CSS clip-path transitions,
// consistent with the rest of this app's plain-CSS styling approach.

const STORAGE_KEY = 'realitycheck:theme';

export const PALETTES = ['blue', 'graphite', 'teal'];
export const PALETTE_LABELS = { blue: 'Reality Blue', graphite: 'Graphite', teal: 'Teal' };

// Mirrors the CSS custom properties in styles.css — kept in sync manually.
// Only used to paint the transition overlay before the real DOM theme
// flips; a mismatch here would just make the transition look slightly off,
// never break functionality (the real page always ends up correctly
// themed via the actual CSS variables).
const PALETTE_COLORS = {
  blue: { light: { bg: '#f4f5f7', surface: '#ffffff' }, dark: { bg: '#14171c', surface: '#1b1f27' } },
  graphite: { light: { bg: '#f1f2f4', surface: '#ffffff' }, dark: { bg: '#16181c', surface: '#1e2126' } },
  teal: { light: { bg: '#f2f8f7', surface: '#ffffff' }, dark: { bg: '#0e1a18', surface: '#142523' } },
};

function systemPrefersDark() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function readStoredPreference() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function storePreference(pref) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pref));
  } catch {
    // localStorage unavailable (private mode, etc.) — theme just won't persist across reloads
  }
}

/** What should actually be shown right now: an explicit stored choice, or system preference if the user has never manually picked light/dark. */
export function resolveTheme() {
  const stored = readStoredPreference();
  const palette = stored?.palette && PALETTES.includes(stored.palette) ? stored.palette : 'blue';
  if (stored?.mode === 'light' || stored?.mode === 'dark') {
    return { mode: stored.mode, palette };
  }
  return { mode: systemPrefersDark() ? 'dark' : 'light', palette };
}

export function applyThemeInstant({ mode, palette }) {
  const root = document.documentElement;
  root.setAttribute('data-theme', mode);
  root.setAttribute('data-palette', palette);
}

/** Call once, as early as possible. (Duplicated as a tiny blocking inline script in index.html so the very first paint is already correctly themed, before this module even loads.) */
export function initTheme() {
  const resolved = resolveTheme();
  applyThemeInstant(resolved);
  return resolved;
}

/**
 * Animated switch: a full-viewport overlay, painted in the NEW theme's
 * color, rises from the bottom (clip-path reveal) to fully cover the
 * screen; the real theme then flips invisibly underneath it; the overlay
 * fades out to reveal the fully-themed real page. Falls back to an
 * instant, un-animated switch under prefers-reduced-motion, or if the
 * overlay element isn't in the DOM for some reason.
 */
export function transitionToTheme({ mode, palette }, { persist = true } = {}) {
  if (persist) storePreference({ mode, palette });

  const overlay = document.getElementById('theme-transition-overlay');
  if (prefersReducedMotion() || !overlay) {
    applyThemeInstant({ mode, palette });
    return;
  }

  const colors = PALETTE_COLORS[palette]?.[mode] || PALETTE_COLORS.blue.light;
  overlay.style.background = `linear-gradient(to top, ${colors.bg} 0%, ${colors.bg} 70%, ${colors.surface} 100%)`;
  overlay.style.transition = 'none';
  overlay.style.clipPath = 'inset(100% 0 0 0)';
  overlay.style.opacity = '1';

  // Force the browser to commit the starting clip-path before animating —
  // otherwise it can coalesce with the next style change and skip straight
  // to the end state instead of transitioning.
  void overlay.offsetHeight;

  overlay.style.transition = 'clip-path 720ms cubic-bezier(0.22, 1, 0.36, 1)';
  overlay.style.clipPath = 'inset(0% 0 0 0)';

  const onRiseDone = () => {
    overlay.removeEventListener('transitionend', onRiseDone);
    applyThemeInstant({ mode, palette }); // hidden behind the now-fully-covering overlay
    overlay.style.transition = 'opacity 220ms ease';
    overlay.style.opacity = '0';
    const onFadeDone = () => {
      overlay.removeEventListener('transitionend', onFadeDone);
      overlay.style.transition = 'none';
      overlay.style.clipPath = 'inset(100% 0 0 0)'; // reset, ready for next use
    };
    overlay.addEventListener('transitionend', onFadeDone);
  };
  overlay.addEventListener('transitionend', onRiseDone);
}
