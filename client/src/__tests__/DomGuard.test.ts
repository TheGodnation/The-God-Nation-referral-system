import { describe, it, expect } from 'vitest';
import { installDomGuard, syncPageLanguage } from '../lib/domGuard';

// A page translator (Chrome "Translate this page") moves text into its own tags; when the app then updates that text, the browser
// used to throw and the chat fell over to the error page. With the guard the update is skipped and nothing throws.
describe('protection against page translators', () => {
  it('does not throw when asked to remove or insert next to a node that a translator has moved elsewhere', () => {
    installDomGuard();
    const parent = document.createElement('div');
    const moved = document.createElement('span');
    const elsewhere = document.createElement('font'); // where a translator puts the text
    elsewhere.appendChild(moved);
    expect(() => parent.removeChild(moved)).not.toThrow();
    expect(moved.parentNode).toBe(elsewhere); // left where it is
    const fresh = document.createElement('b');
    expect(() => parent.insertBefore(fresh, moved)).not.toThrow();
    expect(fresh.parentNode).toBe(parent); // still added (at the end)
  });

  it('still removes and inserts normally', () => {
    installDomGuard();
    const parent = document.createElement('div');
    const a = document.createElement('i');
    const b = document.createElement('u');
    parent.appendChild(a);
    parent.insertBefore(b, a);
    expect(Array.from(parent.childNodes)).toEqual([b, a]);
    parent.removeChild(b);
    expect(Array.from(parent.childNodes)).toEqual([a]);
  });

  it('keeps the page language the same as the app language, so the browser does not offer to translate', () => {
    syncPageLanguage('fr');
    expect(document.documentElement.lang).toBe('fr');
    syncPageLanguage('en-GB');
    expect(document.documentElement.lang).toBe('en');
  });
});
