import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { KnowledgePanel } from '../components/admin/KnowledgePanel';
import i18n from '../i18n';

// The central admin's Knowledge Centre editor: list, write a version, preview, a person's
// approval, stages, and plain error messages from the server.
const calls: { url: string; method: string; body: any }[] = [];
type Res = { status?: number; body: unknown };
let routes: Record<string, (body: any) => Res>;
function mockFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ url, method, body });
      const key = Object.keys(routes).sort((a, b) => b.length - a.length).find((k) => {
        const [m, path] = k.split(' ');
        return m === method && url.endsWith(path);
      });
      const res = key ? routes[key](body) : { status: 404, body: { error: 'not found' } };
      const status = res.status ?? 200;
      return Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => res.body });
    }),
  );
}

const DIVS = [
  { key: 'kingdom-knowledge', name: { en: 'Kingdom Knowledge', fr: 'Connaissance du Royaume' }, slug: { en: 'kingdom-knowledge', fr: 'connaissance-du-royaume' } },
  { key: 'kingdom-leadership', name: { en: 'Kingdom Leadership', fr: 'Leadership du Royaume' }, slug: { en: 'kingdom-leadership', fr: 'leadership-du-royaume' } },
];
const tr = (over: Record<string, unknown> = {}) => ({ lang: 'en', slug: 'faith', title: 'Faith', summary: 'About faith.', body: '## Hi', seoTitle: null, seoDescription: null, readingMinutes: 1, faq: null, reviewedAt: null, reviewedBy: null, publicPath: '/en/knowledge/kingdom-knowledge/faith/', isPublic: false, ...over });
const article = (over: Record<string, unknown> = {}) => ({ id: 'a1', divisionKey: 'kingdom-knowledge', status: 'DRAFT', authorId: null, featuredImageUrl: null, featuredImageAltEn: null, featuredImageAltFr: null, publishedAt: null, aiAssisted: false, sourceNote: null, updatedAt: new Date().toISOString(), translations: [tr()], relatedIds: [], ...over });
const overview = (articles: unknown[]) => ({ divisions: DIVS, authors: [{ id: 'au1', name: 'Evangelist Test', bioEn: null, bioFr: null }], articles });

beforeEach(() => { i18n.changeLanguage('en'); });
afterEach(() => { vi.unstubAllGlobals(); calls.length = 0; });

describe('Knowledge Centre editor', () => {
  it('lists articles with their stage and the review state of each language, and filters by stage', async () => {
    routes = { 'GET /k': () => ({ body: overview([article(), article({ id: 'a2', status: 'PUBLISHED', translations: [tr({ title: 'Published one', reviewedAt: new Date().toISOString() })] })]) }) };
    mockFetch();
    render(<KnowledgePanel base="/k" />);
    await screen.findAllByTestId('kc-row');
    expect(screen.getAllByText('Faith').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Published one').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('kc-row')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Published' }));
    expect(screen.getAllByTestId('kc-row')).toHaveLength(1);
    expect(screen.getAllByTestId('kc-row')[0]).toHaveTextContent('Published one');
  });

  it('creates an article in the chosen area and opens it', async () => {
    routes = {
      'GET /k': () => ({ body: overview([]) }),
      'POST /k/articles': (b) => ({ status: 201, body: article({ id: 'new1', divisionKey: b.divisionKey, translations: [] }) }),
      'GET /k/articles/new1': () => ({ body: article({ id: 'new1', translations: [] }) }),
    };
    mockFetch();
    render(<KnowledgePanel base="/k" />);
    await screen.findByText('Nothing here yet.');
    fireEvent.change(screen.getByLabelText('Knowledge area'), { target: { value: 'kingdom-leadership' } });
    fireEvent.click(screen.getByRole('button', { name: /New article/ }));
    expect(await screen.findByTestId('kc-editor')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ divisionKey: 'kingdom-leadership' });
  });

  it('saves a version, and says plainly when changed words took the approval back', async () => {
    routes = {
      'GET /k': () => ({ body: overview([article()]) }),
      'GET /k/articles/a1': () => ({ body: article({ translations: [tr({ reviewedAt: new Date().toISOString(), reviewedBy: 'me@x.com' })] }) }),
      'PUT /k/articles/a1/translations/en': () => ({ body: { reviewReset: true } }),
    };
    mockFetch();
    render(<KnowledgePanel base="/k" />);
    fireEvent.click((await screen.findAllByTestId('kc-row'))[0]);
    const title = await screen.findByLabelText('Title');
    expect(screen.getByTestId('kc-review')).toHaveTextContent('Approved by me@x.com');
    fireEvent.change(title, { target: { value: 'Faith, new title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save the EN version' }));
    expect(await screen.findByText(/needs to be approved again/)).toBeInTheDocument();
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.body).toMatchObject({ title: 'Faith, new title', summary: 'About faith.', body: '## Hi' });
  });

  it('shows the server-made preview, approves a version, and shows the server’s reason when publishing is refused', async () => {
    let status = 'APPROVED';
    routes = {
      'GET /k': () => ({ body: overview([article({ status })]) }),
      'GET /k/articles/a1': () => ({ body: article({ status }) }),
      'POST /k/preview': () => ({ body: { html: '<h2 id="hi">Hi</h2>', readingMinutes: 1 } }),
      'POST /k/articles/a1/translations/en/review': () => ({ body: { ok: true, approved: true } }),
      'POST /k/articles/a1/status': () => ({ status: 409, body: { error: 'Nobody has reviewed a language version yet. Review at least one before publishing.' } }),
    };
    mockFetch();
    render(<KnowledgePanel base="/k" />);
    fireEvent.click((await screen.findAllByTestId('kc-row'))[0]);
    await screen.findByLabelText('Title');
    fireEvent.click(screen.getByRole('button', { name: 'Preview the text' }));
    expect(await screen.findByTestId('kc-preview')).toContainHTML('<h2 id="hi">Hi</h2>');
    fireEvent.click(screen.getByRole('button', { name: 'Approve the EN version' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/translations/en/review') && c.body?.approved === true)).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(await screen.findByText(/Nobody has reviewed a language version yet/)).toBeInTheDocument();
    expect(calls.find((c) => c.url.endsWith('/status'))?.body).toEqual({ to: 'PUBLISHED' });
    status = 'APPROVED';
  });

  it('offers the right next step at each stage, and a link to the public page once it is public', async () => {
    routes = {
      'GET /k': () => ({ body: overview([article({ status: 'PUBLISHED' })]) }),
      'GET /k/articles/a1': () => ({ body: article({ status: 'PUBLISHED', publishedAt: new Date().toISOString(), translations: [tr({ reviewedAt: new Date().toISOString(), reviewedBy: 'x', isPublic: true })] }) }),
    };
    mockFetch();
    render(<KnowledgePanel base="/k" />);
    fireEvent.click((await screen.findAllByTestId('kc-row'))[0]);
    expect(await screen.findByRole('button', { name: 'Withdraw from the website' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument();
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open on the public website' })).toHaveAttribute('href', '/en/knowledge/kingdom-knowledge/faith/');
  });

  it('speaks French when the app is in French', async () => {
    i18n.changeLanguage('fr');
    routes = { 'GET /k': () => ({ body: overview([article()]) }) };
    mockFetch();
    render(<KnowledgePanel base="/k" />);
    expect(await screen.findByText('Nouvel article', { exact: false })).toBeInTheDocument();
    expect(screen.getAllByText('Brouillon').length).toBeGreaterThan(0);
    expect(screen.getByText('Rédigez des articles', { exact: false })).toBeInTheDocument();
  });

  it('formats the selected words from the toolbar, and shows a live word count', async () => {
    routes = {
      'GET /k': () => ({ body: overview([article()]) }),
      'GET /k/articles/a1': () => ({ body: article() }),
    };
    mockFetch();
    render(<KnowledgePanel base="/k" />);
    fireEvent.click((await screen.findAllByTestId('kc-row'))[0]);
    const body = (await screen.findByLabelText('Article text')) as HTMLTextAreaElement;
    expect(body.value).toBe('## Hi');
    body.setSelectionRange(3, 5);
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
    expect(body.value).toBe('## **Hi**');
    fireEvent.change(body, { target: { value: 'one two three' } });
    expect(screen.getByTestId('kc-words')).toHaveTextContent('3 words · about 1 min read');
  });

  it('shows unsaved changes, keeps them when the other language is saved, and asks before leaving', async () => {
    routes = {
      'GET /k': () => ({ body: overview([article({ translations: [tr(), tr({ lang: 'fr', slug: 'foi', title: 'Foi', summary: 'Sur la foi.', body: 'Texte' })] })]) }),
      'GET /k/articles/a1': () => ({ body: article({ translations: [tr(), tr({ lang: 'fr', slug: 'foi', title: 'Foi', summary: 'Sur la foi.', body: 'Texte' })] }) }),
      'PUT /k/articles/a1/translations/en': () => ({ body: { reviewReset: false } }),
    };
    mockFetch();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<KnowledgePanel base="/k" />);
    fireEvent.click((await screen.findAllByTestId('kc-row'))[0]);
    await screen.findByLabelText('Title');
    expect(screen.queryByTestId('kc-unsaved')).not.toBeInTheDocument();

    // Unsaved words in French ...
    fireEvent.click(screen.getByRole('tab', { name: /Français/ }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Foi, nouveau titre' } });
    expect(screen.getByTestId('kc-unsaved')).toBeInTheDocument();

    // ... survive saving the English version.
    fireEvent.click(screen.getByRole('tab', { name: /English/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save the EN version' }));
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Français/ }));
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Foi, nouveau titre');

    // Leaving asks first; answering "no" stays.
    fireEvent.click(screen.getByRole('button', { name: /All articles/ }));
    expect(confirm).toHaveBeenCalled();
    expect(screen.getByTestId('kc-editor')).toBeInTheDocument();
    confirm.mockRestore();
  });

  it('offers back words that were typed earlier on this device and never saved', async () => {
    localStorage.setItem('kc-draft:a1:en', JSON.stringify({ title: 'Typed last night', summary: 'S', body: 'Long text', slug: 'faith', seoTitle: '', seoDescription: '', faq: [] }));
    routes = {
      'GET /k': () => ({ body: overview([article()]) }),
      'GET /k/articles/a1': () => ({ body: article() }),
    };
    mockFetch();
    render(<KnowledgePanel base="/k" />);
    fireEvent.click((await screen.findAllByTestId('kc-row'))[0]);
    const banner = await screen.findByTestId('kc-restore');
    expect(banner).toHaveTextContent('Words you typed earlier on this device were not saved');
    fireEvent.click(screen.getByRole('button', { name: 'Bring them back' }));
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Typed last night');
    expect(screen.queryByTestId('kc-restore')).not.toBeInTheDocument();
    localStorage.clear();
  });

  it('lists what needs attention: versions waiting for approval and published articles in one language only', async () => {
    const reviewed = new Date().toISOString();
    routes = {
      'GET /k': () => ({
        body: overview([
          article({ id: 'a1', status: 'DRAFT', translations: [tr({ title: 'Needs approving' })] }),
          article({ id: 'a2', status: 'PUBLISHED', translations: [tr({ title: 'English only', reviewedAt: reviewed })] }),
          article({ id: 'a3', status: 'PUBLISHED', translations: [tr({ title: 'Both', reviewedAt: reviewed }), tr({ lang: 'fr', title: 'Les deux', reviewedAt: reviewed })] }),
        ]),
      }),
    };
    mockFetch();
    render(<KnowledgePanel base="/k" />);
    const box = await screen.findByTestId('kc-attention');
    expect(box).toHaveTextContent("Waiting for a person's approval (1)");
    expect(box).toHaveTextContent('Published in one language only (1)');
    expect(box).toHaveTextContent('Needs approving');
    expect(box).toHaveTextContent('English only');
    expect(box).not.toHaveTextContent('Both');
  });
});
