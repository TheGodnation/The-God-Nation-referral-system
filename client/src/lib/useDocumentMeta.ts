import { useEffect } from 'react';

// Phase 2: tiny, zero-dependency SEO helper (page title, meta description,
// canonical URL) for a purely client-rendered SPA with no SSR — deliberately
// not react-helmet or any larger framework. Restores the previous values on
// unmount so navigating between pages never leaves stale meta behind.
export function useDocumentMeta(title: string, description?: string) {
  useEffect(() => {
    const prevTitle = document.title;
    if (title) document.title = title;

    let meta = document.querySelector('meta[name="description"]');
    const prevDescription = meta?.getAttribute('content') ?? null;
    if (description) {
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute('name', 'description');
        document.head.appendChild(meta);
      }
      meta.setAttribute('content', description);
    }

    let canonical = document.querySelector('link[rel="canonical"]');
    const prevCanonical = canonical?.getAttribute('href') ?? null;
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.setAttribute('rel', 'canonical');
      document.head.appendChild(canonical);
    }
    canonical.setAttribute('href', window.location.href);

    return () => {
      document.title = prevTitle;
      if (meta && prevDescription !== null) meta.setAttribute('content', prevDescription);
      if (canonical && prevCanonical !== null) canonical.setAttribute('href', prevCanonical);
    };
  }, [title, description]);
}
