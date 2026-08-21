import { createContext, useEffect, useState } from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';
import HomePage from './pages/HomePage.jsx';
import GuidePage from './pages/GuidePage.jsx';
import TechnicianView from './pages/TechnicianView.jsx';
import SupervisorDashboard from './pages/SupervisorDashboard.jsx';
import TaskDetail from './pages/TaskDetail.jsx';
import KnowledgePage from './pages/KnowledgePage.jsx';
import ThemeSwitcher from './components/ThemeSwitcher.jsx';
import OnboardingTour from './components/OnboardingTour.jsx';
import { isTourCompleted } from './tour.js';

// Lets any page (currently just the Guide page's "Replay tour" button)
// start the onboarding tour without threading props through every route.
export const TourContext = createContext({ startTour: () => {} });

export default function App() {
  const [tourActive, setTourActive] = useState(false);

  useEffect(() => {
    if (!isTourCompleted()) {
      // Small delay so the first paint (and theme) settles before the
      // overlay measures anything.
      const t = setTimeout(() => setTourActive(true), 600);
      return () => clearTimeout(t);
    }
  }, []);

  return (
    <TourContext.Provider value={{ startTour: () => setTourActive(true) }}>
      <div className="app">
        {/* Painted by theme.js during a theme/palette switch; invisible otherwise. */}
        <div id="theme-transition-overlay" className="theme-transition-overlay" aria-hidden="true" />

        <header className="app-header">
          <NavLink to="/" className="brand" end>
            RealityCheck <span className="brand-sub">prove it, don't just say it</span>
          </NavLink>
          <nav>
            <NavLink to="/technician" data-tour="nav-technician" className={({ isActive }) => (isActive ? 'active' : '')}>
              Technician
            </NavLink>
            <NavLink to="/supervisor" data-tour="nav-supervisor" className={({ isActive }) => (isActive ? 'active' : '')}>
              Supervisor
            </NavLink>
            <NavLink to="/guide" data-tour="nav-guide" className={({ isActive }) => (isActive ? 'active' : '')}>
              Guide
            </NavLink>
            <span data-tour="nav-theme">
              <ThemeSwitcher />
            </span>
          </nav>
        </header>
        <main className="app-main">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/guide" element={<GuidePage />} />
            <Route path="/technician" element={<TechnicianView />} />
            <Route path="/supervisor" element={<SupervisorDashboard />} />
            <Route path="/supervisor/knowledge" element={<KnowledgePage />} />
            <Route path="/supervisor/tasks/:id" element={<TaskDetail />} />
          </Routes>
        </main>

        <OnboardingTour active={tourActive} onClose={() => setTourActive(false)} />
      </div>
    </TourContext.Provider>
  );
}
