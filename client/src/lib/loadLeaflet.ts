// Loads the Leaflet map library from a public CDN the first time a map is
// shown (admin-only page, so regular members never download it). Resolves
// to the global `L`, or rejects when it can't be loaded (offline, blocked),
// in which case the page just shows the list without the map.

const VERSION = '1.9.4';
const BASE = `https://cdnjs.cloudflare.com/ajax/libs/leaflet/${VERSION}`;

let loading: Promise<any> | null = null;

export function loadLeaflet(): Promise<any> {
  const w = window as any;
  if (w.L) return Promise.resolve(w.L);
  if (loading) return loading;

  loading = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = `${BASE}/leaflet.min.css`;
    document.head.appendChild(css);

    const script = document.createElement('script');
    script.src = `${BASE}/leaflet.min.js`;
    script.async = true;
    script.onload = () => (w.L ? resolve(w.L) : reject(new Error('Leaflet missing')));
    script.onerror = () => {
      loading = null;
      reject(new Error('Leaflet failed to load'));
    };
    document.head.appendChild(script);
  });
  return loading;
}
