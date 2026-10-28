import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MemberAssessmentPage } from '../pages/MemberAssessmentPage';

// After a teaching's quiz the member is taken back to the teaching (where the
// list of who has finished is) by itself, unless they stay to read the answers.
function mockFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const json = (body: unknown, status = 200) => Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => body });
      if (url.startsWith('/api/settings/public')) return json({ content: {} });
      if (url.startsWith('/api/member/assessments/a1/my-attempts')) return json({ items: [] });
      if (url.startsWith('/api/member/assessments/a1/attempts') && method === 'POST') return json({ id: 'at1' }, 201);
      if (url.startsWith('/api/member/assessments/a1')) {
        return json({ id: 'a1', titleEn: 'Quiz', titleFr: null, passMark: 70, maxAttempts: 1, teaching: { id: 't1', title: 'Walking in love' } });
      }
      if (url.endsWith('/submit')) return json({ id: 'at1', attemptNumber: 1, status: 'SUBMITTED', score: 1, maxScore: 1, percentage: 100, passed: true, submittedAt: '2026-10-28T10:00:00Z' });
      if (url.includes('/attempts/at1/questions')) return json({ questions: [{ id: 'q1', textEn: 'Q?', textFr: null, points: 1, options: [{ id: 'o1', textEn: 'Yes', textFr: null }] }] });
      return json({});
    }),
  );
}
beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Back to the teaching after its quiz', () => {
  it('counts down and goes back to the teaching, with a way to stay', async () => {
    mockFetch();
    render(
      <MemoryRouter initialEntries={['/member/assessments/a1']}>
        <Routes>
          <Route path="/member/assessments/:id" element={<MemberAssessmentPage />} />
          <Route path="/member/teachings/:id" element={<div>The teaching page</div>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /Start/i }));
    fireEvent.click(await screen.findByLabelText('Yes'));
    fireEvent.click(await screen.findByRole('button', { name: /Submit/i }));
    const note = await screen.findByTestId('back-to-teaching');
    expect(note).toHaveTextContent('Taking you back to the teaching');
    // One second at a time: each tick renders the next number.
    for (let i = 0; i < 18; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
    }
    expect(await screen.findByText('The teaching page')).toBeInTheDocument();
  });

  it('stays when the member chooses to read the correct answers', async () => {
    mockFetch();
    render(
      <MemoryRouter initialEntries={['/member/assessments/a1']}>
        <Routes>
          <Route path="/member/assessments/:id" element={<MemberAssessmentPage />} />
          <Route path="/member/teachings/:id" element={<div>The teaching page</div>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /Start/i }));
    fireEvent.click(await screen.findByLabelText('Yes'));
    fireEvent.click(await screen.findByRole('button', { name: /Submit/i }));
    await screen.findByTestId('back-to-teaching');
    fireEvent.click(screen.getByRole('button', { name: 'Stay to read the correct answers' }));
    for (let i = 0; i < 12; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
    }
    expect(screen.queryByText('The teaching page')).not.toBeInTheDocument();
    expect(screen.queryByTestId('back-to-teaching')).not.toBeInTheDocument();
  });
});
