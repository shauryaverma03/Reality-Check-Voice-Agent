// Theme engine — light/dark mode + 3 color palettes (blue/graphite/teal),
// persisted to localStorage, with a circular-reveal transition that expands
// from wherever the user clicked. No animation library — plain CSS clip-path
// transitions, consistent with the rest of this app's plain-CSS approach.

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

/** Radius needed for a circle centred at (x, y) to cover the whole viewport —
 * the distance to whichever corner is furthest away. */
function radiusToCover(x, y) {
  const { innerWidth: w, innerHeight: h } = window;
  return Math.max(
    Math.hypot(x, y),
    Math.hypot(w - x, y),
    Math.hypot(x, h - y),
    Math.hypot(w - x, h - y)
  );
}

/**
 * Animated switch: a full-viewport overlay painted in the NEW theme's colors
 * is revealed as a circle expanding from the control the user actually
 * clicked, so the new theme visibly spreads out from under their finger
 * rather than sliding in from an unrelated edge. Once it covers the screen
 * the real theme flips invisibly underneath, then the overlay fades away.
 *
 * `origin` is the click point ({ x, y } in viewport coordinates); it falls
 * back to the top-right corner (where the switcher lives) if a caller
 * doesn't supply one. Degrades to an instant, un-animated switch under
 * prefers-reduced-motion or if the overlay element isn't in the DOM.
 */
export function transitionToTheme({ mode, palette }, { persist = true, origin = null } = {}) {
  if (persist) storePreference({ mode, palette });

  const overlay = document.getElementById('theme-transition-overlay');
  if (prefersReducedMotion() || !overlay) {
    applyThemeInstant({ mode, palette });
    return;
  }

  const x = origin?.x ?? window.innerWidth - 48;
  const y = origin?.y ?? 40;
  const radius = radiusToCover(x, y);

  const colors = PALETTE_COLORS[palette]?.[mode] || PALETTE_COLORS.blue.light;
  // A soft radial wash rather than a flat fill: the new theme's surface
  // color glows at the origin and settles into its page background, which
  // reads as the theme spreading outward instead of a plain colour wipe.
  overlay.style.background = `radial-gradient(circle at ${x}px ${y}px, ${colors.surface} 0%, ${colors.bg} 55%)`;
  overlay.style.transition = 'none';
  overlay.style.clipPath = `circle(0px at ${x}px ${y}px)`;
  overlay.style.opacity = '1';

  // Force the browser to commit the starting clip-path before animating —
  // otherwise it can coalesce with the next style change and skip straight
  // to the end state instead of transitioning.
  void overlay.offsetHeight;

  overlay.style.transition = 'clip-path 620ms cubic-bezier(0.4, 0, 0.2, 1)';
  overlay.style.clipPath = `circle(${radius}px at ${x}px ${y}px)`;

  const onExpandDone = () => {
    overlay.removeEventListener('transitionend', onExpandDone);
    applyThemeInstant({ mode, palette }); // hidden behind the now-fully-covering overlay
    overlay.style.transition = 'opacity 260ms ease';
    overlay.style.opacity = '0';
    const onFadeDone = () => {
      overlay.removeEventListener('transitionend', onFadeDone);
      overlay.style.transition = 'none';
      overlay.style.clipPath = `circle(0px at ${x}px ${y}px)`; // reset, ready for next use
    };
    overlay.addEventListener('transitionend', onFadeDone);
  };
  overlay.addEventListener('transitionend', onExpandDone);
}
