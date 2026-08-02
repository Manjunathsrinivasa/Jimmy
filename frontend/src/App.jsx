import { Navigate, Route, Routes } from "react-router-dom";
import { useAuthStore } from "./store/authStore";
import { hasPageAccess } from "./components/AppLayout";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Overview from "./pages/Overview";
import Dashboard from "./pages/Dashboard";
import PipelineBuilder from "./pages/PipelineBuilder";
import NewProject from "./pages/NewProject";
import ProjectDetail from "./pages/ProjectDetail";
import Reports from "./pages/Reports";
import Approvals from "./pages/Approvals";
import UserRoles from "./pages/UserRoles";

function RequireAuth({ children }) {
  const token = useAuthStore((s) => s.token);
  if (!token) return <Navigate to="/login" replace />;
  return children;
}

// Route-level page guard: users who were not granted a page are sent back to
// the dashboard instead of seeing the content (direct-URL bypass protection).
function PageGuard({ pageKey, children }) {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  if (!token) return <Navigate to="/login" replace />;
  if (!hasPageAccess(user, pageKey)) return <Navigate to="/dashboard" replace />;
  return children;
}

export default function App() {
  const token = useAuthStore((s) => s.token);

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route
        path="/dashboard"
        element={
          <RequireAuth>
            <Overview />
          </RequireAuth>
        }
      />
      <Route
        path="/pipelines"
        element={
          <PageGuard pageKey="pipelines">
            <Dashboard />
          </PageGuard>
        }
      />
      <Route
        path="/pipelines/:id"
        element={
          <PageGuard pageKey="pipelines">
            <PipelineBuilder />
          </PageGuard>
        }
      />
      <Route
        path="/projects/new"
        element={
          <PageGuard pageKey="new_project">
            <NewProject />
          </PageGuard>
        }
      />
      <Route
        path="/projects/:id"
        element={
          <RequireAuth>
            <ProjectDetail />
          </RequireAuth>
        }
      />
      <Route
        path="/approvals"
        element={
          <PageGuard pageKey="approvals">
            <Approvals />
          </PageGuard>
        }
      />
      <Route
        path="/reports"
        element={
          <PageGuard pageKey="reports">
            <Reports />
          </PageGuard>
        }
      />
      <Route
        path="/users"
        element={
          <PageGuard pageKey="users">
            <UserRoles />
          </PageGuard>
        }
      />
      <Route path="*" element={<Navigate to={token ? "/dashboard" : "/login"} replace />} />
    </Routes>
  );
}
