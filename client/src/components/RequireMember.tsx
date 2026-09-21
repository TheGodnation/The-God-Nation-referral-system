import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useMemberAuth } from '../lib/MemberAuthContext';

// Phase 3C equivalent of ProtectedRoute/RequireAuth, but for the entirely
// separate member session — never checks or interacts with the Admin/
// Leader AuthContext.
export function RequireMember({ children }: { children: ReactNode }) {
  const { member, loading } = useMemberAuth();

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-slate-500">Loading…</div>;
  }

  if (!member) return <Navigate to="/member/login" replace />;

  return <>{children}</>;
}
