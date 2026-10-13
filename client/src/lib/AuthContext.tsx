import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';

export type Role = 'ADMIN' | 'LEADER';

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  mustChangePassword?: boolean;
  personId?: string | null;
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
      // GET /api/auth/me never 401s — "not signed in" always comes back as
      // a normal 200 with user: null, handled right here. So anything that
      // reaches the catch below is a transient failure (a network blip, or
      // a momentary database hiccup surfacing as a 500), never a real "you
      // are logged out" signal — it must not bounce an already-signed-in
      // Admin/Leader to the login screen and discard whatever they were in
      // the middle of doing.
      setUser(res.user);
    } catch {
      // Intentionally left as-is: keep whatever `user` we already had.
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
