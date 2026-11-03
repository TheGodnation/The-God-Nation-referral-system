// @vitest-environment node
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// A permanent guard: every address that exists today must keep existing, and the installed
// app's identity must not change. New addresses may be added; none may be removed or renamed.
// (See docs/APPLICATION_MAP.md. Changing this list needs the owner's explicit approval.)
const appSource = fs.readFileSync(path.join(__dirname, '../App.tsx'), 'utf8');
const routes = [...appSource.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
const existing: string[] = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/existing-routes.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../../public/manifest.webmanifest'), 'utf8'));

describe('Existing addresses contract', () => {
  it('every address the app has today is still there', () => {
    const missing = existing.filter((p) => !routes.includes(p));
    expect(missing).toEqual([]);
  });

  it('no screen of the app is mounted at /en or /fr (those belong to the public website)', () => {
    expect(routes.filter((p) => p === '/en' || p === '/fr' || p.startsWith('/en/') || p.startsWith('/fr/'))).toEqual([]);
  });

  it('the installed app keeps its identity', () => {
    expect(manifest.id).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.start_url).toBe('/member/chats');
    expect(manifest.display).toBe('standalone');
  });
});
