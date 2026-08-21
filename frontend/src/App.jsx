import { Routes, Route, NavLink } from 'react-router-dom';
import HomePage from './pages/HomePage.jsx';
import GuidePage from './pages/GuidePage.jsx';
import TechnicianView from './pages/TechnicianView.jsx';
import SupervisorDashboard from './pages/SupervisorDashboard.jsx';
import TaskDetail from './pages/TaskDetail.jsx';

export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <NavLink to="/" className="brand" end>
          RealityCheck <span className="brand-sub">prove it, don't just say it</span>
        </NavLink>
        <nav>
          <NavLink to="/technician" className={({ isActive }) => (isActive ? 'active' : '')}>
            Technician
          </NavLink>
          <NavLink to="/supervisor" className={({ isActive }) => (isActive ? 'active' : '')}>
            Supervisor
          </NavLink>
          <NavLink to="/guide" className={({ isActive }) => (isActive ? 'active' : '')}>
            Guide
          </NavLink>
        </nav>
      </header>
      <main className="app-main">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/guide" element={<GuidePage />} />
          <Route path="/technician" element={<TechnicianView />} />
          <Route path="/supervisor" element={<SupervisorDashboard />} />
          <Route path="/supervisor/tasks/:id" element={<TaskDetail />} />
        </Routes>
      </main>
    </div>
  );
}
