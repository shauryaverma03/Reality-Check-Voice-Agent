import { createContext, useEffect, useState } from 'react';
import { Routes, Route, NavLink, useLocation } from 'react-router-dom';
import HomePage from './pages/HomePage.jsx';
import GuidePage from './pages/GuidePage.jsx';
import TechnicianView from './pages/TechnicianView.jsx';
import SupervisorDashboard from './pages/SupervisorDashboard.jsx';
import TaskDetail from './pages/TaskDetail.jsx';
import KnowledgePage from './pages/KnowledgePage.jsx';
import ObservabilityPage from './pages/ObservabilityPage.jsx';
import ThemeSwitcher from './components/ThemeSwitcher.jsx';
import OnboardingTour from './components/OnboardingTour.jsx';
import { isTourCompleted } from './tour.js';

// Lets any page (currently just the Guide page's "Replay tour" button)
// start the onboarding tour without threading props through every route.
export const TourContext = createContext({ startTour: () => {} });

const NAV_LINKS = [
  { to: '/technician', label: 'Technician', tour: 'nav-technician' },
  { to: '/supervisor', label: 'Supervisor', tour: 'nav-supervisor' },
  { to: '/guide', label: 'Guide', tour: 'nav-guide' },
];

export default function App() {
  const [tourActive, setTourActive] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    if (!isTourCompleted()) {
      // Small delay so the first paint (and theme) settles before the
      // overlay measures anything.
      const t = setTimeout(() => setTourActive(true), 600);
      return () => clearTimeout(t);
    }
  }, []);

  // Navigating away should always close the mobile menu — otherwise it stays
  // open over the page the user just asked for.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  return (
    <TourContext.Provider value={{ startTour: () => setTourActive(true) }}>
      <div className="app">
        {/* Painted by theme.js during a theme/palette switch; invisible otherwise. */}
        <div id="theme-transition-overlay" className="theme-transition-overlay" aria-hidden="true" />

        <header className="app-header">
          <div className="app-header-inner">
            <NavLink to="/" className="brand" end>
              <span className="brand-mark" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2.6 4 6v6c0 4.6 3.4 8.3 8 9.4 4.6-1.1 8-4.8 8-9.4V6Z" />
                  <path d="m8.8 12 2.2 2.2 4.2-4.4" />
                </svg>
              </span>
              <span className="brand-text">
                <span className="brand-name">RealityCheck</span>
                <span className="brand-sub">prove it, don't just say it</span>
              </span>
            </NavLink>

            <nav className="nav-desktop" aria-label="Main">
              {NAV_LINKS.map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  data-tour={l.tour}
                  className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                >
                  {l.label}
                </NavLink>
              ))}
            </nav>

            <div className="header-actions">
              <span data-tour="nav-theme">
                <ThemeSwitcher />
              </span>
              <button
                type="button"
                className={`nav-burger${menuOpen ? ' is-open' : ''}`}
                onClick={() => setMenuOpen((o) => !o)}
                aria-label={menuOpen ? 'Close menu' : 'Open menu'}
                aria-expanded={menuOpen}
                aria-controls="mobile-nav"
              >
                <span aria-hidden="true" />
                <span aria-hidden="true" />
                <span aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Rendered only when open so the links aren't in the tab order
              (or reachable by screen readers) while the panel is closed. */}
          {menuOpen && (
            <nav id="mobile-nav" className="nav-mobile" aria-label="Main">
              {NAV_LINKS.map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  className={({ isActive }) => `nav-mobile-link${isActive ? ' active' : ''}`}
                >
                  {l.label}
                </NavLink>
              ))}
            </nav>
          )}
        </header>

        <main className="app-main">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/guide" element={<GuidePage />} />
            <Route path="/technician" element={<TechnicianView />} />
            <Route path="/supervisor" element={<SupervisorDashboard />} />
            <Route path="/supervisor/knowledge" element={<KnowledgePage />} />
            <Route path="/supervisor/observability" element={<ObservabilityPage />} />
            <Route path="/supervisor/tasks/:id" element={<TaskDetail />} />
          </Routes>
        </main>

        <OnboardingTour active={tourActive} onClose={() => setTourActive(false)} />
      </div>
    </TourContext.Provider>
  );
}
