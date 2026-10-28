import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ExamResults } from '../components/admin/ExamResults';

// The admin Results list: every quiz / exam try, searchable, copyable as a
// message, downloadable as a spreadsheet; inside a person's page it is just
// that person's own list.
const ROW = {
  attemptId: 'a1',
  personId: 'p1',
  personName: 'Marie Ngo',
  whatsappNumber: '+237650000001',
  kind: 'TEACHING',
  title: 'Walking in love',
  assemblyName: 'HQ',
  tryNumber: 1,
  score: 8,
  maxScore: 10,
  percentage: 80,
  passMark: 50,
  passed: true,
  submittedAt: '2026-10-28T10:00:00Z',
};
const urls: string[] = [];

function mockFetch(items: object[] = [ROW]) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      urls.push(url);
      const body = url.startsWith('/api/admin/communities')
        ? { items: [{ id: 'c1', name: 'HQ' }] }
        : { items, pagination: { page: 1, pageSize: 20, total: items.length, totalPages: 1 } };
      return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  urls.length = 0;
});

describe('Admin quiz and exam results', () => {
  it('lists each result with its score and copies a line to send on WhatsApp', async () => {
    mockFetch();
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    render(<ExamResults />);
    expect(await screen.findByText('Marie Ngo')).toBeInTheDocument();
    expect(screen.getByText('Walking in love')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect((writeText.mock.calls[0] as unknown as string[])[0]).toMatch(/^Marie Ngo — Walking in love \(teaching quiz\): 80%, passed, 28 October 2026$/);
  });

  it('searches by name and offers the same filter as a spreadsheet download', async () => {
    mockFetch();
    render(<ExamResults />);
    await screen.findByText('Marie Ngo');
    fireEvent.change(screen.getByLabelText('Search by name, WhatsApp number or email'), { target: { value: 'Marie' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(urls.some((u) => u.startsWith('/api/admin/results?') && u.includes('search=Marie'))).toBe(true));
    await waitFor(() => expect(screen.getByTestId('results-download').getAttribute('href')).toBe('/api/admin/results/export?search=Marie'));
  });

  it('inside a person’s page shows only their list, with no search form', async () => {
    mockFetch();
    render(<ExamResults personId="p1" />);
    await screen.findByText('Walking in love');
    expect(urls.some((u) => u.includes('personId=p1'))).toBe(true);
    expect(screen.queryByLabelText('Search by name, WhatsApp number or email')).not.toBeInTheDocument();
    expect(screen.queryByText('Marie Ngo')).not.toBeInTheDocument();
  });

  it('says so when there are no results', async () => {
    mockFetch([]);
    render(<ExamResults />);
    expect(await screen.findByText('No results yet.')).toBeInTheDocument();
  });
});
