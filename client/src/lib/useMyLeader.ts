import { useEffect, useState } from 'react';
import { api } from './api';

export interface MyLeader {
  personId: string;
  name: string;
  photoUrl: string | null;
}

// The leader the signed-in person has been told about (or null). One request per page load is enough.
let cached: Promise<MyLeader | null> | null = null;
export function resetMyLeaderCacheForTests() {
  cached = null;
}
function load(): Promise<MyLeader | null> {
  if (!cached) {
    cached = api
      .get<{ leader: MyLeader | null }>('/api/member/my-leader')
      .then((r) => r.leader)
      .catch(() => {
        cached = null;
        return null;
      });
  }
  return cached;
}

export function useMyLeader(): MyLeader | null {
  const [leader, setLeader] = useState<MyLeader | null>(null);
  useEffect(() => {
    let live = true;
    void load().then((l) => live && setLeader(l));
    return () => {
      live = false;
    };
  }, []);
  return leader;
}
