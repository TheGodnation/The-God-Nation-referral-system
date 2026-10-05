import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MemberLearnPage } from '../pages/MemberLearnPage';
import { MemberAssessmentPage } from '../pages/MemberAssessmentPage';
import { MemberAuthProvider } from '../lib/MemberAuthContext';

const calls: { url: string; method: string; body: any }[] = [];

function mockFetch(routes: Record<string, (body: any) => { status?: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ url, method, body });
      const key = Object.keys(routes)
        .sort((a, b) => b.length - a.length)
        .find((k) => {
          const [m, path] = k.split(' ');
          return m === method && url.startsWith(path);
        });
      const res = key ? routes[key](body) : { status: 404, body: { error: 'not found' } };
      const status = res.status ?? 200;
      return Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => res.body });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
});

const ME = { member: { name: 'Me', email: 'me@x.com', preferredLanguage: 'en', locationCountry: null, locationCity: null, locationArea: null, personId: 'me' } };

const WORLD = {
  offering: { instructionsEn: 'Give by MoMo to 6XX', instructionsFr: null },
  devotionals: [
    {
      id: 'd1',
      titleEn: 'Walking in faith',
      titleFr: null,
      descriptionEn: null,
      descriptionFr: null,
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      bookId: 'book-d1',
      iGaveOffering: false,
      exams: [
        { id: 'w1', weekNumber: 1, titleEn: 'W1', titleFr: null, passMark: 50, open: true, firstScore: 80, firstPassed: true, tries: 1 },
        { id: 'w2', weekNumber: 2, titleEn: 'W2', titleFr: null, passMark: 50, open: true, firstScore: null, firstPassed: null, tries: 0 },
      ],
    },
  ],
  training: {
    enrollment: 'ACTIVE',
    books: [
      { id: 'b1', trainingOrder: 1, titleEn: 'Vision', titleFr: null, descriptionEn: null, descriptionFr: null, unlocked: true, canRead: true, exam: { id: 'e1', passMark: 70, bestPercentage: 90, passed: true } },
      { id: 'b2', trainingOrder: 2, titleEn: 'Character', titleFr: null, descriptionEn: null, descriptionFr: null, unlocked: true, canRead: true, exam: { id: 'e2', passMark: 70, bestPercentage: null, passed: false } },
      { id: 'b3', trainingOrder: 3, titleEn: 'Service', titleFr: null, descriptionEn: null, descriptionFr: null, unlocked: false, canRead: false, exam: null },
    ],
  },
};

function renderLearn() {
  return render(
    <MemoryRouter initialEntries={['/member/learn']}>
      <MemberAuthProvider>
        <Routes>
          <Route path="/member/learn" element={<MemberLearnPage />} />
        </Routes>
      </MemberAuthProvider>
    </MemoryRouter>,
  );
}

describe('Exam World (Learn page)', () => {
  it('shows the devotional with Read, weekly exam scores, and books in order with locks', async () => {
    mockFetch({ 'GET /api/member/auth/me': () => ({ body: ME }), 'GET /api/member/exam-world': () => ({ body: WORLD }) });
    renderLearn();
    const devotional = await screen.findByRole('article', { name: 'Walking in faith' });
    expect(within(devotional).getByRole('link', { name: 'Read' })).toHaveAttribute('href', '/member/read/book-d1');
    expect(within(devotional).getByText('80%')).toBeInTheDocument();
    expect(within(devotional).getByRole('link', { name: 'Take exam' })).toHaveAttribute('href', '/member/assessments/w2');

    expect(screen.getByText('Passed with 90%')).toBeInTheDocument();
    expect(screen.getByText(/🔒 Book 3: Service/)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Exam' }).map((a) => a.getAttribute('href'))).toEqual(['/member/assessments/e1', '/member/assessments/e2']);
  });

  it('records a free-will offering with an optional amount', async () => {
    mockFetch({
      'GET /api/member/auth/me': () => ({ body: ME }),
      'GET /api/member/exam-world': () => ({ body: WORLD }),
      'POST /api/member/devotionals/d1/offering': () => ({ status: 201, body: { id: 'o1' } }),
    });
    renderLearn();
    expect(await screen.findByText('Give by MoMo to 6XX')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'I have given' }));
    fireEvent.change(screen.getByLabelText('Amount (optional)'), { target: { value: '2 000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('✓ Thank you for your offering. God bless you!')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ amount: 2000 });
  });

  it('lets a non-trainee ask to join leadership training', async () => {
    mockFetch({
      'GET /api/member/auth/me': () => ({ body: ME }),
      'GET /api/member/exam-world': () => ({ body: { ...WORLD, training: { enrollment: 'NONE', books: [] } } }),
      'POST /api/member/training/request': () => ({ status: 201, body: { enrollment: 'REQUESTED' } }),
    });
    renderLearn();
    fireEvent.click(await screen.findByRole('button', { name: 'I want to join leadership training' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/member/training/request')).toBe(true));
  });
});

describe('Exam page: thank you, score and right answers', () => {
  it('shows the thank-you message and the right answers after submitting', async () => {
    mockFetch({
      'GET /api/member/auth/me': () => ({ body: ME }),
      'GET /api/member/assessments/w2/my-attempts': () => ({ body: { items: [] } }),
      'GET /api/member/assessments/w2': () => ({ body: { id: 'w2', titleEn: 'Week 2 exam', titleFr: null, passMark: 50, maxAttempts: null, firstTryCounts: true, open: true } }),
      'POST /api/member/assessments/w2/attempts': () => ({ status: 201, body: { id: 'att1' } }),
      'GET /api/member/attempts/att1/questions': () => ({
        body: {
          status: 'SUBMITTED',
          questions: [
            {
              id: 'q1',
              textEn: 'Who is the Good Shepherd?',
              textFr: null,
              points: 1,
              options: [
                { id: 'o1', textEn: 'Jesus', textFr: null, isCorrect: true },
                { id: 'o2', textEn: 'Moses', textFr: null, isCorrect: false },
              ],
              selectedOptionId: 'o2',
              wasCorrect: false,
            },
          ],
        },
      }),
      'POST /api/member/attempts/att1/submit': () => ({ body: { id: 'att1', attemptNumber: 1, status: 'SUBMITTED', score: 0, maxScore: 1, percentage: 0, passed: false, submittedAt: 'x' } }),
    });
    render(
      <MemoryRouter initialEntries={['/member/assessments/w2']}>
        <MemberAuthProvider>
          <Routes>
            <Route path="/member/assessments/:id" element={<MemberAssessmentPage />} />
          </Routes>
        </MemberAuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Only your first try counts. Any later try is for practice.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /start/i }));
    fireEvent.click(await screen.findByLabelText('Moses'));
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));

    expect(await screen.findByText('Thank you! Your answers were submitted.')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'The right answers' })).toBeInTheDocument();
    expect(screen.getByText(/✓ Jesus/)).toBeInTheDocument();
    expect(screen.getByText(/✗ Moses/)).toBeInTheDocument();
  });
});
