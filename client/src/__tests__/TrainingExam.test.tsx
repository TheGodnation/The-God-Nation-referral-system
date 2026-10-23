import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MemberAssessmentPage } from '../pages/MemberAssessmentPage';

// A leadership book's exam: one try, explained before it starts; no
// correct answers afterwards; a retake must be asked for.
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
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

const training = (over: Record<string, unknown> = {}) => ({
  inProgressAttemptId: null,
  submittedTries: 0,
  passed: false,
  retakeGranted: false,
  canStart: true,
  block: null,
  ...over,
});

const exam = (t: ReturnType<typeof training>) => ({
  id: 'e1',
  titleEn: 'Book 1 exam: Called to lead',
  titleFr: null,
  passMark: 70,
  maxAttempts: null,
  open: true,
  firstTryCounts: false,
  training: t,
});

function renderExam() {
  return render(
    <MemoryRouter initialEntries={['/member/assessments/e1']}>
      <Routes>
        <Route path="/member/assessments/:id" element={<MemberAssessmentPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const QUESTIONS = {
  status: 'IN_PROGRESS',
  questions: [
    {
      id: 'q1',
      textEn: 'In chapter 1, the book teaches that a leader first learns to ___',
      textFr: null,
      points: 1,
      options: [
        { id: 'o1', textEn: 'serve', textFr: null },
        { id: 'o2', textEn: 'command', textFr: null },
      ],
    },
  ],
};

describe('Leadership book exam', () => {
  it('explains the one-try rule before starting, keeps chosen answers on the phone, and never shows the correct answers', async () => {
    mockFetch({
      'GET /api/member/assessments/e1/my-attempts': () => ({ body: { items: [] } }),
      'GET /api/member/assessments/e1': () => ({ body: exam(training()) }),
      'POST /api/member/assessments/e1/attempts': () => ({ status: 201, body: { id: 'a1' } }),
      'GET /api/member/attempts/a1/questions': () => ({ body: QUESTIONS }),
      'POST /api/member/attempts/a1/submit': () => ({ body: { id: 'a1', attemptNumber: 1, status: 'SUBMITTED', score: 1, maxScore: 1, percentage: 100, passed: true, submittedAt: 'now' } }),
    });
    renderExam();
    expect(await screen.findByText(/One try only\. If you score below 70%/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(screen.getByText('Before you start')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/attempts'))).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'I understand, start the exam' }));
    fireEvent.click(await screen.findByLabelText('serve'));
    expect(JSON.parse(localStorage.getItem('exam-answers:a1') ?? '{}')).toEqual({ q1: 'o1' });

    fireEvent.click(screen.getByRole('button', { name: 'Submit Answers' }));
    expect(await screen.findByText('Score: 1 / 1 (100%)')).toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem('exam-answers:a1')).toBeNull());
    expect(calls.filter((c) => c.url === '/api/member/attempts/a1/questions')).toHaveLength(1);
    expect(screen.queryByText('The right answers')).not.toBeInTheDocument();
  });

  it('after a failed try: asks for a retake, then says it was sent', async () => {
    let state = training({ canStart: false, block: 'NEEDS_RETAKE', submittedTries: 1 });
    mockFetch({
      'GET /api/member/assessments/e1/my-attempts': () => ({ body: { items: [] } }),
      'GET /api/member/assessments/e1': () => ({ body: exam(state) }),
      'POST /api/member/assessments/e1/retake-request': () => {
        state = training({ canStart: false, block: 'RETAKE_REQUESTED', submittedTries: 1 });
        return { status: 201, body: { training: state } };
      },
    });
    renderExam();
    expect(await screen.findByText(/You did not reach 70% this time/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ask for a retake' }));
    expect(await screen.findByText(/Your retake request was sent/)).toBeInTheDocument();
  });

  it('says when a granted retake brings new questions', async () => {
    mockFetch({
      'GET /api/member/assessments/e1/my-attempts': () => ({ body: { items: [] } }),
      'GET /api/member/assessments/e1': () => ({ body: exam(training({ retakeGranted: true, submittedTries: 1 })) }),
    });
    renderExam();
    expect(await screen.findByText('Your retake is granted. You will get a new set of questions.')).toBeInTheDocument();
  });
});
