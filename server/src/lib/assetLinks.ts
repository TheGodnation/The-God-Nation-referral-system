import type { Request, Response } from 'express';

// The file Google Play uses to check that this website and the Android app belong together
// (Digital Asset Links, served at /.well-known/assetlinks.json). Without it the Android app
// shows a browser address bar. It is filled from two settings on the server, once the app is
// signed in Play Console:
//   ANDROID_PACKAGE_NAME        e.g. org.thegodnationacademy.app
//   ANDROID_SHA256_FINGERPRINTS one or more signing fingerprints, separated by commas
// Until both are set the address answers "not found" (never the app's home page).

const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;
const PACKAGE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;

export function assetLinks(env: NodeJS.ProcessEnv = process.env): unknown[] | null {
  const pkg = (env.ANDROID_PACKAGE_NAME ?? '').trim();
  const prints = (env.ANDROID_SHA256_FINGERPRINTS ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  if (!PACKAGE.test(pkg) || prints.length === 0 || !prints.every((p) => FINGERPRINT.test(p))) return null;
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: prints },
    },
  ];
}

export function assetLinksHandler(req: Request, res: Response) {
  const body = assetLinks();
  if (!body) return res.status(404).set('Cache-Control', 'no-store').type('text/plain').send('Not found.');
  res.set('Cache-Control', 'public, max-age=3600').type('application/json').send(JSON.stringify(body));
}
