import { useEffect } from 'react';
import { recordLandingVisitOnce } from '../lib/trackVisit';

// Mounted once at the top of the app: notes where a new visitor came from.
export function LandingVisitTracker() {
  useEffect(() => {
    recordLandingVisitOnce();
  }, []);
  return null;
}
