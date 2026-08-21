import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import TechnicianView from './pages/TechnicianView.jsx';
import SupervisorDashboard from './pages/SupervisorDashboard.jsx';
import TaskDetail from './pages/TaskDetail.jsx';

export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          RealityCheck <span className="brand-sub">prove it, don't just say it</span>
        </div>
        <nav>
          <NavLink to="/technician" className={({ isActive }) => (isActive ? 'active' : '')}>
            Technician
          </NavLink>
          <NavLink to="/supervisor" className={({ isActive }) => (isActive ? 'active' : '')}>
            Supervisor
          </NavLink>
        </nav>
      </header>
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Navigate to="/technician" replace />} />
          <Route path="/technician" element={<TechnicianView />} />
          <Route path="/supervisor" element={<SupervisorDashboard />} />
          <Route path="/supervisor/tasks/:id" element={<TaskDetail />} />
        </Routes>
      </main>
    </div>
  );
}
