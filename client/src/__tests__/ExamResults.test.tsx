import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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
  assessmentId: 'as1',
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

  it('opens the quiz at a glance: the hardest question first, with the answer key for the admin', async () => {
    const summary = {
      assessmentId: 'as1',
      title: 'Walking in love',
      assemblyName: 'HQ',
      passMark: 50,
      taken: 9,
      passed: 8,
      averagePercentage: 76,
      lowestPercentage: 20,
      highestPercentage: 100,
      questions: [
        { questionId: 'q2', textEn: 'Where did it happen?', textFr: null, answered: 9, correct: 3, correctPercentage: 33, correctAnswerEn: 'Galilee', mostChosenWrongEn: { text: 'Rome', count: 5 } },
        { questionId: 'q1', textEn: 'Who is it about?', textFr: null, answered: 9, correct: 9, correctPercentage: 100, correctAnswerEn: 'Jesus', mostChosenWrongEn: null },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        urls.push(url);
        const body = url.startsWith('/api/admin/results/quiz/')
          ? summary
          : url.startsWith('/api/admin/communities')
            ? { items: [] }
            : { items: [ROW], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 } };
        return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body });
      }),
    );
    render(<ExamResults />);
    await screen.findByText('Marie Ngo');
    fireEvent.click(screen.getByRole('button', { name: 'Quiz summary' }));
    const panel = await screen.findByTestId('quiz-summary');
    expect(urls).toContain('/api/admin/results/quiz/as1');
    expect(within(panel).getByText(/9 took it · 8 passed/)).toBeInTheDocument();
    expect(within(panel).getByText(/Average 76% \(lowest 20%, highest 100%\)/)).toBeInTheDocument();
    const questions = within(panel).getAllByTestId('summary-question');
    expect(questions[0]).toHaveTextContent('1. Where did it happen?');
    expect(questions[0]).toHaveTextContent('33% right (3 of 9)');
    expect(questions[0]).toHaveTextContent('Right answer: Galilee');
    expect(questions[0]).toHaveTextContent('Wrong answer chosen most: Rome (5)');
    fireEvent.click(within(panel).getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('quiz-summary')).not.toBeInTheDocument();
  });

  it('a leader’s view reads their own members’ marks, with no assembly picker and no answer key', async () => {
    mockFetch();
    render(<ExamResults base="/api/leader/results" hideWhenEmpty />);
    expect(await screen.findByText('My members’ quiz and exam marks')).toBeInTheDocument();
    await screen.findByText('Marie Ngo');
    expect(urls.some((u) => u.startsWith('/api/leader/results?'))).toBe(true);
    expect(urls.some((u) => u.startsWith('/api/admin/communities'))).toBe(false);
    expect(screen.queryByLabelText('Assembly')).not.toBeInTheDocument();
    expect(screen.getByTestId('results-download').getAttribute('href')).toBe('/api/leader/results/export?');
  });

  it('a leader with no results sees nothing at all', async () => {
    mockFetch([]);
    const { container } = render(<ExamResults base="/api/leader/results" hideWhenEmpty />);
    await waitFor(() => expect(urls.length).toBeGreaterThan(0));
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
