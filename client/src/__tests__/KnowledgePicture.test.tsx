import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import i18n from '../i18n';

const uploadPicture = vi.hoisted(() => vi.fn());
vi.mock('../lib/knowledgePicture', async (orig) => ({ ...(await orig<typeof import('../lib/knowledgePicture')>()), uploadPicture }));

import { KnowledgePanel } from '../components/admin/KnowledgePanel';
import { PictureError, type Prepared } from '../lib/knowledgePicture';

// The real sending steps (the editor tests above use a stand-in for them).
const realUpload = (...args: Parameters<typeof import('../lib/knowledgePicture').uploadPicture>) =>
  vi.importActual<typeof import('../lib/knowledgePicture')>('../lib/knowledgePicture').then((m) => m.uploadPicture(...args));

const calls: { url: string; method: string; body: any }[] = [];
let routes: Record<string, (body: any) => { status?: number; body: unknown }>;
function mockFetch() {
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ url, method, body });
    const key = Object.keys(routes).sort((a, b) => b.length - a.length).find((k) => { const [m, path] = k.split(' '); return m === method && url.endsWith(path); });
    const res = key ? routes[key](body) : { status: 404, body: { error: 'not found' } };
    const status = res.status ?? 200;
    return Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => res.body });
  }));
}
const DIVS = [{ key: 'kingdom-knowledge', name: { en: 'Kingdom Knowledge', fr: 'Connaissance du Royaume' }, slug: { en: 'kingdom-knowledge', fr: 'connaissance-du-royaume' } }];
const article = (over: Record<string, unknown> = {}) => ({ id: 'a1', divisionKey: 'kingdom-knowledge', status: 'DRAFT', authorId: null, featuredImageUrl: null, featuredImageAltEn: null, featuredImageAltFr: null, publishedAt: null, aiAssisted: false, sourceNote: null, updatedAt: new Date().toISOString(), translations: [], relatedIds: [], ...over });
const ITEM = { id: 'm1', url: '/media/k/m1.jpg', byteSize: 120000, width: 1200, height: 800, altEn: null, altFr: null };

beforeEach(() => { i18n.changeLanguage('en'); uploadPicture.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); calls.length = 0; });

async function openEditor() {
  mockFetch();
  render(<KnowledgePanel base="/k" />);
  fireEvent.click((await screen.findAllByTestId('kc-row'))[0]);
  return screen.findByTestId('kc-picture');
}

describe('Picture upload in the editor', () => {
  it('shows progress, then the chosen picture, and saves it with the details', async () => {
    routes = {
      'GET /k': () => ({ body: { divisions: DIVS, authors: [], articles: [article()] } }),
      'GET /k/articles/a1': () => ({ body: article() }),
      'PUT /k/articles/a1': () => ({ body: article({ featuredImageUrl: ITEM.url }) }),
    };
    uploadPicture.mockImplementation(async (_b: string, _f: Blob, onStage: (s: string, f?: number) => void) => { onStage('preparing'); onStage('sending', 0.4); return ITEM; });
    const box = await openEditor();
    expect(box).toHaveTextContent('No picture yet.');
    const input = box.querySelector('input[type=file]') as HTMLInputElement;
    expect(input.accept).toBe('image/jpeg,image/png,image/webp');
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' })] } });
    await waitFor(() => expect(box.querySelector('img')).toHaveAttribute('src', '/media/k/m1.jpg'));
    expect(uploadPicture).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Choose another picture/ })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Picture description (English)'), { target: { value: 'A pastor teaching' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save the details' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url.endsWith('/k/articles/a1'))).toBe(true));
    expect(calls.find((c) => c.method === 'PUT' && c.url.endsWith('/k/articles/a1'))?.body).toMatchObject({ featuredImageUrl: '/media/k/m1.jpg', featuredImageAltEn: 'A pastor teaching' });
  });

  it('says plainly why a picture could not be sent', async () => {
    routes = { 'GET /k': () => ({ body: { divisions: DIVS, authors: [], articles: [article()] } }), 'GET /k/articles/a1': () => ({ body: article() }) };
    const box = await openEditor();
    const input = box.querySelector('input[type=file]') as HTMLInputElement;
    const pick = () => fireEvent.change(input, { target: { files: [new File([new Uint8Array(10)], 'p.jpg', { type: 'image/jpeg' })] } });
    uploadPicture.mockRejectedValueOnce(new PictureError('read'));
    pick();
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be read as a picture');
    uploadPicture.mockRejectedValueOnce(new PictureError('send'));
    pick();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('could not be sent'));
    uploadPicture.mockRejectedValueOnce(new PictureError('storage_off'));
    pick();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('not available right now'));
  });

  it('offers pictures uploaded earlier, fills the descriptions from them, and removes only unused ones', async () => {
    routes = {
      'GET /k': () => ({ body: { divisions: DIVS, authors: [], articles: [article()] } }),
      'GET /k/articles/a1': () => ({ body: article() }),
      'GET /k/media': () => ({ body: { items: [{ ...ITEM, altEn: 'A pastor teaching', altFr: 'Un pasteur enseigne', inUse: false }, { ...ITEM, id: 'm2', url: '/media/k/m2.jpg', inUse: true }] } }),
      'DELETE /k/media/m1': () => ({ body: { ok: true } }),
    };
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const box = await openEditor();
    fireEvent.click(box.querySelector('details summary') as HTMLElement);
    await waitFor(() => expect(box.querySelectorAll('ul img')).toHaveLength(2));
    // Only the unused one can be deleted.
    expect(box.querySelectorAll('ul button.text-red-700, ul li > button:not([aria-label])')).toHaveLength(1);
    fireEvent.click(box.querySelectorAll('ul li button[aria-label="Use this picture"]')[0]);
    expect((screen.getByLabelText('Picture description (English)') as HTMLInputElement).value).toBe('A pastor teaching');
    expect((screen.getByLabelText('Picture description (French)') as HTMLInputElement).value).toBe('Un pasteur enseigne');
    confirm.mockRestore();
  });
});

describe('Sending a picture', () => {
  const prepared: Prepared = { blob: new Blob([new Uint8Array(1000)]), mimeType: 'image/jpeg', width: 1200, height: 800 };

  it('asks for permission, sends the file to storage, then registers it', async () => {
    const puts: { url: string; type: string }[] = [];
    class FakeXhr {
      upload: { onprogress?: (e: unknown) => void } = {};
      onload?: () => void; onerror?: () => void; status = 200; url = ''; type = '';
      open(_m: string, url: string) { this.url = url; }
      setRequestHeader(_k: string, v: string) { this.type = v; }
      send() { puts.push({ url: this.url, type: this.type }); this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 }); this.onload?.(); }
    }
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    routes = {
      'POST /k/media/authorize': (b) => ({ body: { id: 'm9', uploadUrl: 'https://storage.test/knowledge/m9.jpg?signed', publicUrl: '/media/k/m9.jpg', echo: b } }),
      'POST /k/media/m9/finalize': () => ({ status: 201, body: { ...ITEM, id: 'm9', url: '/media/k/m9.jpg' } }),
    };
    mockFetch();
    const stages: string[] = [];
    const item = await realUpload('/k', new Blob([]), (s) => stages.push(s), async () => prepared);
    expect(item.url).toBe('/media/k/m9.jpg');
    expect(puts).toEqual([{ url: 'https://storage.test/knowledge/m9.jpg?signed', type: 'image/jpeg' }]);
    expect(calls[0].body).toEqual({ mimeType: 'image/jpeg', byteSize: 1000 });
    expect(calls[1].body).toEqual({ mimeType: 'image/jpeg', width: 1200, height: 800 });
    expect(stages).toEqual(['preparing', 'sending', 'sending', 'saving']);
  });

  it('reports a file that cannot be read, a storage that is off, and a failed send', async () => {
    mockFetch();
    routes = { 'POST /k/media/authorize': () => ({ status: 503, body: { error: 'off', code: 'STORAGE_UNAVAILABLE' } }) };
    await expect(realUpload('/k', new Blob([]), () => {}, async () => { throw new Error('bad'); })).rejects.toMatchObject({ reason: 'read' });
    await expect(realUpload('/k', new Blob([]), () => {}, async () => prepared)).rejects.toMatchObject({ reason: 'storage_off' });
    class FailXhr { upload = {}; onerror?: () => void; open() {} setRequestHeader() {} send() { this.onerror?.(); } }
    vi.stubGlobal('XMLHttpRequest', FailXhr);
    routes = { 'POST /k/media/authorize': () => ({ body: { id: 'm9', uploadUrl: 'https://storage.test/x' } }) };
    await expect(realUpload('/k', new Blob([]), () => {}, async () => prepared)).rejects.toMatchObject({ reason: 'send' });
  });
});
