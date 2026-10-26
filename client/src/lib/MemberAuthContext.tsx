import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, NetworkError } from './api';
import { deleteAllFor } from './offlineStore';
import { clearAllDrafts, pruneDrafts } from './drafts';

export interface CurrentMember {
  name: string;
  email: string;
  preferredLanguage: 'en' | 'fr';
  locationCountry: string | null;
  locationCity: string | null;
  locationArea: string | null;
  locationRegion?: string | null;
  locationDivision?: string | null;
  locationSubdivision?: string | null;
  locationQuarter?: string | null;
  // false only for a brand-new sign-up who still has to fill in their
  // details; missing (older server) is treated as complete.
  profileComplete?: boolean;
  personId?: string;
  // Path of the member's own profile picture, or null when they have none.
  photoUrl?: string | null;
  // The wide picture at the top of the member's wall, and a short line
  // about themselves.
  coverUrl?: string | null;
  bio?: string | null;
}

interface MemberAuthContextValue {
  member: CurrentMember | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

// The member signed in last on this phone (a few details only), for opening
// the app without internet. Cleared when they sign out or the server says
// nobody is signed in.
const LAST_MEMBER = 'member:last';

function remember(member: CurrentMember | null) {
  try {
    if (member?.personId) {
      const { name, email, preferredLanguage, personId, profileComplete, photoUrl } = member;
      localStorage.setItem(LAST_MEMBER, JSON.stringify({ name, email, preferredLanguage, personId, profileComplete, photoUrl }));
    } else {
      localStorage.removeItem(LAST_MEMBER);
    }
  } catch {
    // Storage unavailable: the app simply needs the internet to open.
  }
}

function remembered(): CurrentMember | null {
  try {
    const raw = localStorage.getItem(LAST_MEMBER);
    if (!raw) return null;
    const m = JSON.parse(raw);
    return m && typeof m.personId === 'string'
      ? { locationCountry: null, locationCity: null, locationArea: null, ...m }
      : null;
  } catch {
    return null;
  }
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
      let res: { member: CurrentMember | null };
      try {
        res = await api.get<{ member: CurrentMember | null }>('/api/member/auth/me');
      } catch {
        // One immediate retry: the server has an intermittent, momentary
        // database reconnect blip (recurring "Error in PostgreSQL
        // connection: Closed" on the server) that clears itself within a
        // second. Without this, a first page load that happens to land on
        // that exact instant leaves `member` stuck at null for the whole
        // visit — nothing else ever calls refresh() again.
        await new Promise((r) => setTimeout(r, 800));
        res = await api.get<{ member: CurrentMember | null }>('/api/member/auth/me');
      }
      // GET /api/member/auth/me never 401s — "not signed in" always comes
      // back as a normal 200 with member: null, handled right here. So
      // anything reaching the catch below (after the retry above also
      // failed) is a transient failure, never a real "you are logged out"
      // signal — it must not bounce an already-signed-in member to the
      // login screen and discard whatever they were in the middle of doing.
      setMember(res.member);
      remember(res.member);
    } catch (err) {
      // Intentionally left as-is: keep whatever `member` we already had.
      // With no internet at all (the app opened offline), use the member
      // who was signed in last time on this phone, so their downloaded
      // books still open; the server checks again once it is reachable.
      if (err instanceof NetworkError) setMember((current) => current ?? remembered());
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    await api.post('/api/member/auth/logout');
    const personId = member?.personId;
    setMember(null);
    remember(null);
    // Books and documents downloaded for this member leave the phone with them.
    if (personId) void deleteAllFor(personId);
    // Unsent drafts leave the phone too, so the next person never sees them.
    clearAllDrafts();
  }

  useEffect(() => {
    pruneDrafts();
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <MemberAuthContext.Provider value={{ member, loading, refresh, logout }}>{children}</MemberAuthContext.Provider>;
}

export function useMemberAuth() {
  return useContext(MemberAuthContext);
}
