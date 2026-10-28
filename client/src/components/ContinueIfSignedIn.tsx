import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMemberAuth } from '../lib/MemberAuthContext';
import { useAuth } from '../lib/AuthContext';

// Someone who is already signed in should never be asked to sign in again
// just because they opened the public address (tapped the logo, typed the
// website, opened a bookmark). Wrap a public entry page in this: members go
// straight into the community, leaders and the central admin to their own
// dashboard; everybody else sees the page as usual.
//
// While the app is still asking the server who is signed in, a phone that
// had a member last time shows "Opening…" instead of flashing the public
// page first.
function hadMemberBefore(): boolean {
  try {
    return localStorage.getItem('member:last') !== null;
  } catch {
    return false;
  }
}

export function ContinueIfSignedIn({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { member, loading } = useMemberAuth();
  const { user, loading: staffLoading } = useAuth();

  if (member) return <Navigate to="/member/chats" replace />;
  if (loading || staffLoading) {
    if (hadMemberBefore()) {
      return <div className="flex min-h-screen items-center justify-center text-slate-500">{t('common.opening_app')}</div>;
    }
    return <>{children}</>;
  }
  if (user) return <Navigate to={user.role === 'ADMIN' ? '/admin/dashboard' : '/leader/dashboard'} replace />;
  return <>{children}</>;
}
