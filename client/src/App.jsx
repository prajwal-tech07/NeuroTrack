import { lazy } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import AppLayout from './components/AppLayout.jsx';
import { PageLoader } from './components/ui.jsx';

import Landing from './pages/Landing.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import NotFound from './pages/NotFound.jsx';

// The signed-in area pulls in charting and the vision pipeline, neither of which
// a visitor on the landing or login page needs.
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Assessment = lazy(() => import('./pages/Assessment.jsx'));
const Result = lazy(() => import('./pages/Result.jsx'));
const Reports = lazy(() => import('./pages/Reports.jsx'));
const History = lazy(() => import('./pages/History.jsx'));
const Profile = lazy(() => import('./pages/Profile.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));

function Protected({ children }) {
  const { isAuthenticated, booting } = useAuth();
  const location = useLocation();

  if (booting) return <PageLoader label="Restoring your session" />;
  if (!isAuthenticated) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

function PublicOnly({ children }) {
  const { isAuthenticated, booting } = useAuth();
  if (booting) return <PageLoader />;
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route
        path="/login"
        element={
          <PublicOnly>
            <Login />
          </PublicOnly>
        }
      />
      <Route
        path="/register"
        element={
          <PublicOnly>
            <Register />
          </PublicOnly>
        }
      />

      <Route
        element={
          <Protected>
            <AppLayout />
          </Protected>
        }
      >
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/assessment" element={<Assessment />} />
        <Route path="/result/:id" element={<Result />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/history" element={<History />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/settings" element={<Settings />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
