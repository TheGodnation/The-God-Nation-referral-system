import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useStoreApp } from '../lib/storeApp';

/** A screen that does not exist in the Play Store version (Giving, Earnings): anyone who reaches it goes back to their profile. */
export function StoreHidden({ children }: { children: ReactNode }) {
  return useStoreApp() ? <Navigate to="/member/me" replace /> : <>{children}</>;
}
