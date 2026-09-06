import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth, type Role } from '../lib/AuthContext';

export function ProtectedRoute({ role, children }: { role: Role; children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-slate-500">Loading…</div>;
  }

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role) return <Navigate to="/" replace />;
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />;

  return <>{children}</>;
}

/** Gates a route behind "any authenticated user", regardless of role —
 * used for /change-password, which both Admin and Leader must reach. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-slate-500">Loading…</div>;
  }

  if (!user) return <Navigate to="/login" replace />;

  return <>{children}</>;
}
