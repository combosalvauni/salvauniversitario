import { Suspense, lazy, useEffect, useRef } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { AuthLayout } from './components/layout/AuthLayout';
import { AuthProvider, useAuth } from './context/AuthContext';

const importLogin = () => import('./pages/Login');
const importDashboard = () => import('./pages/Dashboard');
const importPlataformas = () => import('./pages/Plataformas');
const importChat = () => import('./pages/Chat');
const importConta = () => import('./pages/Conta');
const importLoja = () => import('./pages/Loja');
const importAdmin = () => import('./pages/Admin');

const Login = lazy(() => importLogin().then((module) => ({ default: module.Login })));
const Dashboard = lazy(() => importDashboard().then((module) => ({ default: module.Dashboard })));
const Plataformas = lazy(() => importPlataformas().then((module) => ({ default: module.Plataformas })));
const Chat = lazy(() => importChat().then((module) => ({ default: module.Chat })));
const Conta = lazy(() => importConta().then((module) => ({ default: module.Conta })));
const Loja = lazy(() => importLoja().then((module) => ({ default: module.Loja })));
const Admin = lazy(() => importAdmin().then((module) => ({ default: module.Admin })));

function App() {
  return (
    <AuthProvider>
      <Router>
        <div className="min-h-screen bg-background text-text-main font-body selection:bg-primary selection:text-white">
          <MetaPixelRouteTracker />
          <RoutePrefetch />
          <Suspense fallback={<RouteLoading />}> 
            <Routes>
              <Route path="/" element={<RootRedirect />} />

              {/* Public Routes (Auth) */}
              <Route element={<AuthLayout />}>
                <Route path="/login" element={<LoginRoute><Login /></LoginRoute>} />
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
              <Route path="*" element={<CatchAllRedirect />} />
            </Routes>
          </Suspense>
        </div>
      </Router>
    </AuthProvider>
  );
}

function MetaPixelRouteTracker() {
  const location = useLocation();
  const firstRenderRef = useRef(true);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.fbq !== 'function') return;

    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }

    window.fbq('track', 'PageView');
  }, [location.pathname, location.search]);

  return null;
}

function RoutePrefetch() {
  const { user, isAdmin, canAccessStore } = useAuth();
  const location = useLocation();
  const prefetchedRef = useRef(new Set());

  useEffect(() => {
    if (!user) return;

    const connection = typeof navigator !== 'undefined' ? navigator.connection : null;
    const effectiveType = String(connection?.effectiveType || '').toLowerCase();
    const isConstrainedNetwork = ['slow-2g', '2g', '3g'].includes(effectiveType);
    const lowMemoryDevice = typeof navigator !== 'undefined'
      && typeof navigator.deviceMemory === 'number'
      && navigator.deviceMemory <= 4;
    if (connection?.saveData) return;

    const importers = {
      plataformas: importPlataformas,
      dashboard: importDashboard,
      conta: importConta,
      chat: importChat,
      loja: importLoja,
      admin: importAdmin,
    };

    const available = new Set(['plataformas', 'dashboard', 'conta', 'chat']);
    if (canAccessStore) available.add('loja');
    if (isAdmin) available.add('admin');

    const priorityByPath = {
      '/plataformas': ['loja', 'conta', 'dashboard', 'chat', 'admin'],
      '/dashboard': ['plataformas', 'conta', 'chat', 'loja', 'admin'],
      '/conta': ['plataformas', 'loja', 'dashboard', 'chat', 'admin'],
      '/chat': ['plataformas', 'conta', 'dashboard', 'loja', 'admin'],
      '/loja': ['plataformas', 'conta', 'dashboard', 'chat', 'admin'],
      '/admin': ['dashboard', 'plataformas', 'conta', 'chat', 'loja'],
    };

    const baseQueue = priorityByPath[location.pathname] || ['plataformas', 'dashboard', 'conta', 'chat', 'loja', 'admin'];
    const maxPrefetchCount = isConstrainedNetwork || lowMemoryDevice ? 2 : 6;
    const queue = baseQueue
      .filter((key) => available.has(key) && !prefetchedRef.current.has(key))
      .slice(0, maxPrefetchCount);
    if (!queue.length) return;

    let cancelled = false;
    let cursor = 0;
    let idleHandle = null;
    let timeoutHandle = null;

    const runBatch = (deadline) => {
      if (cancelled) return;

      while (cursor < queue.length) {
        if (deadline && typeof deadline.timeRemaining === 'function' && deadline.timeRemaining() < 5) {
          break;
        }

        const key = queue[cursor++];
        prefetchedRef.current.add(key);
        importers[key]?.();
      }

      if (cursor < queue.length && !cancelled) {
        if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
          idleHandle = window.requestIdleCallback(runBatch, { timeout: 1200 });
        } else {
          timeoutHandle = window.setTimeout(() => runBatch(), 120);
        }
      }
    };

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      idleHandle = window.requestIdleCallback(runBatch, { timeout: isConstrainedNetwork ? 1400 : 800 });
      return () => {
        cancelled = true;
        if (idleHandle != null) window.cancelIdleCallback(idleHandle);
        if (timeoutHandle != null) window.clearTimeout(timeoutHandle);
      };
    }

    timeoutHandle = window.setTimeout(() => runBatch(), 240);
    return () => {
      cancelled = true;
      if (timeoutHandle != null) window.clearTimeout(timeoutHandle);
    };
  }, [user, isAdmin, canAccessStore, location.pathname]);

  return null;
}

function RouteLoading() {
  return (
    <div className="flex h-[60vh] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

function RootRedirect() {
  const { user } = useAuth();
  return <Navigate to={user ? '/plataformas' : '/login'} replace />;
}

function LoginRoute({ children }) {
  const { user } = useAuth();
  if (user) return <Navigate to="/plataformas" replace />;
  return children;
}

function CatchAllRedirect() {
  const { user } = useAuth();
  return <Navigate to={user ? '/plataformas' : '/login'} replace />;
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
  if (!isAdmin) return <Navigate to="/plataformas" replace />;
  return children;
}

function StoreRoute({ children }) {
  const { user, canAccessStore, profileLoading } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (profileLoading) return null;
  if (!canAccessStore) return <Navigate to="/plataformas" replace />;
  return children;
}

export default App;
