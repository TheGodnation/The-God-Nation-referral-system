import { api } from './api';
import { isOfflineError } from './offlineStore';

// For pages that should still open without internet (the Leadership School
// and its books): the last answer from the server is kept on the phone and
// shown, marked as saved, when the server can't be reached.
export async function cachedGet<T>(path: string, cacheKey: string): Promise<{ data: T; fromCache: boolean }> {
  try {
    const data = await api.get<T>(path);
    try {
      localStorage.setItem(cacheKey, JSON.stringify(data));
    } catch {
      // No room: it simply isn't kept.
    }
    return { data, fromCache: false };
  } catch (err) {
    if (isOfflineError(err)) {
      try {
        const raw = localStorage.getItem(cacheKey);
        if (raw) return { data: JSON.parse(raw) as T, fromCache: true };
      } catch {
        // Fall through to the original error.
      }
    }
    throw err;
  }
}
