import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';

export type Role = 'ADMIN' | 'LEADER';

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  mustChangePassword?: boolean;
}

interface AuthContextValue {
  user: CurrentUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  refresh: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const res = await api.get<{ user: CurrentUser | null }>('/api/auth/me');
      setUser(res.user);
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    await api.post('/api/auth/logout');
    setUser(null);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <AuthContext.Provider value={{ user, loading, refresh, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
