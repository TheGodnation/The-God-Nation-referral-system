import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';

export interface CurrentMember {
  name: string;
  email: string;
  preferredLanguage: 'en' | 'fr';
}

interface MemberAuthContextValue {
  member: CurrentMember | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

// Phase 3C: entirely separate from AuthContext (Admin/Leader) — its own
// state, its own API calls (/api/member/auth/*), never shares a value with
// the Admin/Leader `user` context.
const MemberAuthContext = createContext<MemberAuthContextValue>({
  member: null,
  loading: true,
  refresh: async () => {},
  logout: async () => {},
});

export function MemberAuthProvider({ children }: { children: ReactNode }) {
  const [member, setMember] = useState<CurrentMember | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const res = await api.get<{ member: CurrentMember | null }>('/api/member/auth/me');
      setMember(res.member);
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    await api.post('/api/member/auth/logout');
    setMember(null);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <MemberAuthContext.Provider value={{ member, loading, refresh, logout }}>{children}</MemberAuthContext.Provider>;
}

export function useMemberAuth() {
  return useContext(MemberAuthContext);
}
