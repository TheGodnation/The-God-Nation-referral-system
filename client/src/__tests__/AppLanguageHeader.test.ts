import { describe, it, expect, vi, afterEach } from 'vitest';
import { api } from '../lib/api';
import i18n from '../i18n';

// Every request says which language the app is shown in, so posts and chat
// messages come back translated into it.
afterEach(async () => {
  vi.unstubAllGlobals();
  await i18n.changeLanguage('en');
});

describe('X-App-Language', () => {
  it('follows the language the app is switched to', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchMock);

    await i18n.changeLanguage('fr');
    await api.get('/api/updates');
    await i18n.changeLanguage('en');
    await api.get('/api/updates');

    const sent = fetchMock.mock.calls.map((c: any[]) => (c[1] as RequestInit).headers as Record<string, string>);
    expect(sent[0]['X-App-Language']).toBe('fr');
    expect(sent[1]['X-App-Language']).toBe('en');
  });
});
