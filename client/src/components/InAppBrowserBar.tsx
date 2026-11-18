import { useLocation } from 'react-router-dom';
import { InAppBrowserNotice } from './InAppBrowserNotice';

// The "open this page in your phone's browser" notice on EVERY page, not only the home and sign-up pages: a link from
// Facebook, Messenger, Instagram, TikTok or WhatsApp can land anywhere. "Open in Chrome" always opens the very page
// the person is on, and "Not now" hides it for the rest of the visit.
export function InAppBrowserBar({ userAgent }: { userAgent?: string }) {
  const location = useLocation();
  const href = typeof window !== 'undefined' ? `${window.location.origin}${location.pathname}${location.search}` : undefined;
  return (
    <div className="px-4">
      <InAppBrowserNotice userAgent={userAgent} href={href} />
    </div>
  );
}
