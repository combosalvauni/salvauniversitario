import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { AuthLayout } from './components/layout/AuthLayout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Plataformas } from './pages/Plataformas';
import { Chat } from './pages/Chat';
import { Conta } from './pages/Conta';
import { Loja } from './pages/Loja';
import { Admin } from './pages/Admin';
import { AuthProvider, useAuth } from './context/AuthContext';

function App() {
  return (
    <AuthProvider>
      <Router>
        <div className="min-h-screen bg-background text-text-main font-body selection:bg-primary selection:text-white">
          <Routes>
            {/* Public Routes (Auth) */}
            <Route element={<AuthLayout />}>
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Navigate to="/login" replace />} />
            </Route>

            {/* Protected Routes (Main App) */}
            <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/plataformas" element={<Plataformas />} />
              <Route path="/chat" element={<Chat />} />
              <Route path="/loja" element={<StoreRoute><Loja /></StoreRoute>} />
              <Route path="/conta" element={<Conta />} />
              <Route path="/admin" element={<AdminRoute><Admin /></AdminRoute>} />
            </Route>

            {/* Default Redirect */}
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </div>
      </Router>
    </AuthProvider>
  );
}

function ProtectedRoute({ children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function AdminRoute({ children }) {
  const { user, isAdmin, profileLoading } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (profileLoading) return null;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;
  return children;
}

function StoreRoute({ children }) {
  const { user, canAccessStore, profileLoading } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (profileLoading) return null;
  if (!canAccessStore) return <Navigate to="/dashboard" replace />;
  return children;
}

export default App;
