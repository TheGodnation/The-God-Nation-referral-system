import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MemberClinicPage } from '../pages/MemberClinicPage';
import { ClinicRhythmCard } from '../components/admin/ClinicRhythmCard';

// The member's Dominion Clinic page (how it works, exam scores and total) and
// the central admin's rhythm settings.
const calls: { url: string; method: string; body: any }[] = [];
function mockFetch(handlers: Record<string, (init?: RequestInit) => unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : undefined });
      const key = Object.keys(handlers).sort((a, b) => b.length - a.length).find((k) => url.includes(k));
      return Promise.resolve({ ok: Boolean(key), status: key ? 200 : 404, headers: { get: () => 'application/json' }, json: async () => (key ? handlers[key](init) : {}) });
    }),
  );
}
afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
});

const future = new Date(Date.now() + 5 * 86400000).toISOString();
const data = {
  rhythm: { examEveryDays: 10, examQuestions: 10, topicRhythm: 'EVERY_3_DAYS' },
  exams: [
    { assessmentId: 'a1', number: 1, monthTitleEn: 'November', monthTitleFr: 'Novembre', opensAt: '2026-11-01T00:00:00Z', open: true, score: 8, maxScore: 10, percentage: 80, passed: true, takenAt: '2026-11-03T00:00:00Z' },
    { assessmentId: 'a2', number: 2, monthTitleEn: 'November', monthTitleFr: 'Novembre', opensAt: '2026-11-11T00:00:00Z', open: true, score: null, maxScore: null, percentage: null, passed: null, takenAt: null },
    { assessmentId: 'a3', number: 3, monthTitleEn: 'November', monthTitleFr: 'Novembre', opensAt: future, open: false, score: null, maxScore: null, percentage: null, passed: null, takenAt: null },
  ],
  total: { exams: 1, score: 8, maxScore: 10 },
};

describe('MemberClinicPage', () => {
  it('explains how it works with the current rhythm, and shows each exam score and the total', async () => {
    mockFetch({ '/api/member/clinic': () => data });
    render(<MemoryRouter><MemberClinicPage /></MemoryRouter>);
    expect(await screen.findByText(/An exam comes about every 10 days: 10 questions, taken only from the book/)).toBeInTheDocument();
    expect(screen.getByText('A new topic is taught every 3 days.')).toBeInTheDocument();
    expect(screen.getByText(/exam questions and answers come only from the book/)).toBeInTheDocument();
    const results = screen.getByTestId('clinic-results');
    expect(results).toHaveTextContent('Total: 8 of 10 correct answers in 1 exams');
    expect(results).toHaveTextContent('8 / 10 (80%)');
    expect(screen.getByRole('link', { name: 'Take the exam' })).toHaveAttribute('href', '/member/assessments/a2');
    expect(results).toHaveTextContent(/Opens \d/);
  });

  it('is in French too', async () => {
    mockFetch({ '/api/member/clinic': () => data });
    const { default: i18n } = await import('../i18n');
    await i18n.changeLanguage('fr');
    render(<MemoryRouter><MemberClinicPage /></MemoryRouter>);
    expect(await screen.findByText(/Un examen arrive environ tous les 10 jours/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Clinique de la Domination' })).toBeInTheDocument();
    await i18n.changeLanguage('en');
  });
});

describe('ClinicRhythmCard', () => {
  it('shows the current rhythm and saves a change', async () => {
    mockFetch({
      '/api/admin/cells/clinic/settings': (init) => (init?.method === 'PUT' ? JSON.parse(init.body as string) : { topicRhythm: 'DAILY', examEveryDays: 10, examQuestions: 10 }),
    });
    render(<ClinicRhythmCard base="/api/admin/cells" />);
    fireEvent.change(await screen.findByLabelText('Days between exams'), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText('New topic'), { target: { value: 'MORNING_EVENING' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ topicRhythm: 'MORNING_EVENING', examEveryDays: 7, examQuestions: 10 });
  });
});
