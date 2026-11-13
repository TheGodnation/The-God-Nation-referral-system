import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { TrainingOrganizer } from '../components/admin/TrainingOrganizer';
import i18n from '../i18n';

// The admin arranges the curriculum: levels, and books in order (a book's number is its place), moved with buttons.
const calls: { url: string; method: string; body: any }[] = [];
const book = (id: string, titleEn: string, trainingOrder: number) => ({ id, titleEn, titleFr: null, trainingOrder, hasFile: true, examStatus: 'PUBLISHED' });
let structure: any;

function mockFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
      const out = method === 'GET' || url.includes('/move') || url.includes('/level') ? structure : { ok: true, id: 'x' };
      return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => out });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
  i18n.changeLanguage('en');
});

const level = (id: string, position: number, titleEn: string, books: any[]) => ({ id, position, titleEn, titleFr: null, summaryEn: null, summaryFr: null, books });

describe('Arrange the curriculum', () => {
  it('lists the levels with their books and numbers, and disables moves that go nowhere', async () => {
    structure = { levels: [level('L1', 1, 'Level 1: Foundations', [book('b1', 'The Restoration of Dominion', 1), book('b2', 'The Doorway', 2)]), level('L2', 2, 'Level 2: The Kingdom Keys', [book('b3', 'Keys 1', 3)])], unplaced: [] };
    mockFetch();
    render(<TrainingOrganizer onChanged={() => {}} />);
    const l1 = await screen.findByTestId('org-level-L1');
    expect(within(l1).getByText('Level 1: Foundations')).toBeInTheDocument();
    expect(within(l1).getByTestId('org-book-b1')).toHaveTextContent('Book 1 · The Restoration of Dominion');
    expect(screen.getByTestId('org-book-b3')).toHaveTextContent('Book 3 · Keys 1');
    // Nothing is above Book 1 or below the last book; the first level cannot go up, the last cannot go down.
    expect(screen.getByTestId('book-up-b1')).toBeDisabled();
    expect(screen.getByTestId('book-down-b3')).toBeDisabled();
    expect(screen.getByTestId('book-down-b1')).toBeEnabled();
    expect(screen.getByTestId('level-up-L1')).toBeDisabled();
    expect(screen.getByTestId('level-down-L2')).toBeDisabled();
  });

  it('moves a book, moves it to another level, moves a level, and tells the page to refresh', async () => {
    structure = { levels: [level('L1', 1, 'Foundations', [book('b1', 'One', 1), book('b2', 'Two', 2)]), level('L2', 2, 'Keys', [book('b3', 'Three', 3)])], unplaced: [] };
    mockFetch();
    const onChanged = vi.fn();
    render(<TrainingOrganizer onChanged={onChanged} />);
    fireEvent.click(await screen.findByTestId('book-down-b1'));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')).toMatchObject({ url: '/api/admin/library/training/books/b1/move', body: { direction: 'down' } }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    calls.length = 0;
    fireEvent.change(screen.getByTestId('book-level-b2'), { target: { value: 'L2' } });
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')).toMatchObject({ url: '/api/admin/library/training/books/b2/level', body: { levelId: 'L2' } }));
    calls.length = 0;
    fireEvent.click(screen.getByTestId('level-down-L1'));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')).toMatchObject({ url: '/api/admin/library/training/levels/L1/move', body: { direction: 'down' } }));
  });

  it('adds a book at a number (in between), or at the end of a chosen level', async () => {
    structure = { levels: [level('L1', 1, 'Foundations', [book('b1', 'One', 1)]), level('L2', 2, 'Keys', [book('b2', 'Two', 2)])], unplaced: [] };
    mockFetch();
    render(<TrainingOrganizer onChanged={() => {}} />);
    await screen.findByTestId('new-book-form');
    fireEvent.change(screen.getByTestId('new-book-title-en'), { target: { value: 'Between' } });
    fireEvent.change(screen.getByTestId('new-book-number'), { target: { value: '2' } });
    fireEvent.click(screen.getByTestId('new-book-add'));
    await waitFor(() => expect(calls.find((c) => c.url === '/api/admin/library/books')?.body).toEqual({ kind: 'TRAINING', titleEn: 'Between', trainingOrder: 2 }));
    calls.length = 0;
    fireEvent.change(screen.getByTestId('new-book-title-en'), { target: { value: 'Last of keys' } });
    fireEvent.change(screen.getByTestId('new-book-level'), { target: { value: 'L2' } });
    fireEvent.click(screen.getByTestId('new-book-add'));
    await waitFor(() => expect(calls.find((c) => c.url === '/api/admin/library/books')?.body).toEqual({ kind: 'TRAINING', titleEn: 'Last of keys', levelId: 'L2' }));
  });

  it('adds a level, edits one, and only lets an empty level be removed', async () => {
    structure = { levels: [level('L1', 1, 'Foundations', [book('b1', 'One', 1)]), level('L2', 2, 'Empty one', [])], unplaced: [] };
    mockFetch();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<TrainingOrganizer onChanged={() => {}} />);
    await screen.findByTestId('org-level-L1');
    expect(screen.getByTestId('level-delete-L1')).toBeDisabled();
    expect(screen.getByTestId('level-delete-L2')).toBeEnabled();
    fireEvent.click(screen.getByTestId('level-delete-L2'));
    await waitFor(() => expect(calls.find((c) => c.method === 'DELETE')?.url).toBe('/api/admin/library/training/levels/L2'));
    calls.length = 0;
    fireEvent.change(screen.getByTestId('new-level-title'), { target: { value: 'Level 4: Mission' } });
    fireEvent.click(screen.getByTestId('new-level-add'));
    await waitFor(() => expect(calls.find((c) => c.url.endsWith('/training/levels') && c.method === 'POST')?.body).toEqual({ titleEn: 'Level 4: Mission' }));
    calls.length = 0;
    fireEvent.click(screen.getByTestId('level-edit-L1'));
    fireEvent.change(screen.getByLabelText('Level title (English)'), { target: { value: 'Basics' } });
    fireEvent.click(screen.getByTestId('level-save-L1'));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({ url: '/api/admin/library/training/levels/L1', body: { titleEn: 'Basics' } }));
  });

  it('speaks French', async () => {
    await i18n.changeLanguage('fr');
    structure = { levels: [], unplaced: [] };
    mockFetch();
    render(<TrainingOrganizer onChanged={() => {}} />);
    expect(await screen.findByText('Organiser le cursus')).toBeInTheDocument();
  });

  it('edits the introduction of the Academy page and can bring back the standard text', async () => {
    let custom = { en: false, fr: false };
    let en = 'Standard English intro';
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        calls.push({ url, method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
        let out: any = { levels: [], unplaced: [] };
        if (url.includes('/training/intro')) {
          if (method === 'PUT') {
            const b = JSON.parse(init!.body as string);
            custom = { en: Boolean(b.en), fr: Boolean(b.fr) };
            en = b.en || 'Standard English intro';
          }
          out = { en, fr: 'Texte standard', customEn: custom.en, customFr: custom.fr };
        }
        return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => out });
      }),
    );
    render(<TrainingOrganizer onChanged={() => {}} />);
    fireEvent.click(await screen.findByTestId('intro-toggle'));
    const box = await screen.findByTestId('intro-en');
    await waitFor(() => expect(box).toHaveValue('Standard English intro'));
    expect(screen.getByTestId('intro-fr')).toHaveValue('Texte standard');
    fireEvent.change(box, { target: { value: 'My own words' } });
    fireEvent.click(screen.getByTestId('intro-save'));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')).toMatchObject({ url: '/api/admin/library/training/intro', body: { en: 'My own words', fr: 'Texte standard' } }));
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    calls.length = 0;
    fireEvent.click(screen.getByTestId('intro-reset'));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ en: '', fr: '' }));
    await waitFor(() => expect(screen.getByTestId('intro-en')).toHaveValue('Standard English intro'));
  });
});
