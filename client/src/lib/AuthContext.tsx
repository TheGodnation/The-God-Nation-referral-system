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
      let res: { user: CurrentUser | null };
      try {
        res = await api.get<{ user: CurrentUser | null }>('/api/auth/me');
      } catch {
        // One immediate retry: the server has an intermittent, momentary
        // database reconnect blip (recurring "Error in PostgreSQL
        // connection: Closed" on the server) that clears itself within a
        // second. Without this, a first page load that happens to land on
        // that exact instant leaves `user` stuck at null for the whole
        // visit — nothing else ever calls refresh() again — which silently
        // hides anything gated on being signed in (e.g. a Leader's "My
        // Leadership Dashboard" section on their Member profile).
        await new Promise((r) => setTimeout(r, 800));
        res = await api.get<{ user: CurrentUser | null }>('/api/auth/me');
      }
      // GET /api/auth/me never 401s — "not signed in" always comes back as
      // a normal 200 with user: null, handled right here. So anything that
      // reaches the catch below (after the retry above also failed) is a
      // transient failure, never a real "you are logged out" signal — it
      // must not bounce an already-signed-in Admin/Leader to the login
      // screen and discard whatever they were in the middle of doing.
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
