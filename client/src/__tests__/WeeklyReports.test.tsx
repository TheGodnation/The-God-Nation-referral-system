import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { WeeklyReportForm } from '../components/leader/WeeklyReportForm';
import { LeadersReportPanel } from '../components/admin/LeadersReportPanel';

const calls: { url: string; method: string; body: any }[] = [];
function mockFetch(routes: Record<string, (body: any) => { status?: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body });
      const key = Object.keys(routes).sort((a, b) => b.length - a.length).find((k) => {
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

const future = new Date(Date.now() + 3 * 86400000).toISOString();
const current = (over: Record<string, unknown> = {}) => ({ weekStart: '2026-11-09', weekEnd: '2026-11-15', deadline: future, isLate: false, canEdit: true, report: null, hint: { followedUp: 0 }, colour: 'YELLOW', ...over });

describe('WeeklyReportForm (a leader)', () => {
  it('sends the report for the week with the numbers, prayer needs and a note', async () => {
    mockFetch({
      'GET /api/member/weekly-report/current': () => ({ body: current() }),
      'GET /api/member/weekly-report/history': () => ({ body: { items: [] } }),
      'PUT /api/member/weekly-report': () => ({ body: { weekStart: '2026-11-09' } }),
    });
    render(<WeeklyReportForm />);
    expect(await screen.findByText(/Week of 9 Nov to 15 Nov/)).toBeInTheDocument();
    const send = screen.getByRole('button', { name: 'Send my report' });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/How many people did you contact/), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText(/How many people need help/), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText(/Prayer needs/), { target: { value: 'Healing for Ada' } });
    fireEvent.change(screen.getByLabelText(/A note for the central team/), { target: { value: 'Good week' } });
    await waitFor(() => expect(send).toBeEnabled());
    fireEvent.click(send);
    expect(await screen.findByRole('status')).toHaveTextContent('Report saved. Thank you!');
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ weekStart: '2026-11-09', contacted: 12, needHelp: 3, prayerNeeds: 'Healing for Ada', note: 'Good week' });
  });

  it('offers the in-app number as a hint, and shows what was already sent', async () => {
    mockFetch({
      'GET /api/member/weekly-report/current': () => ({ body: current({ hint: { followedUp: 7 } }) }),
      'GET /api/member/weekly-report/history': () => ({ body: { items: [{ weekStart: '2026-11-02', contacted: 5, needHelp: 1, prayerNeeds: null, note: null, late: true, submittedAt: '2026-11-10T10:00:00Z' }] } }),
    });
    render(<WeeklyReportForm />);
    expect(await screen.findByText(/you followed up 7 people this week/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use this number' }));
    expect(screen.getByLabelText(/How many people did you contact/)).toHaveValue(7);
    expect(await screen.findByText(/5 contacted · 1 need help/)).toBeInTheDocument();
    expect(screen.getByText(/sent late/)).toBeInTheDocument();
  });

  it('says when a report was sent and can no longer be changed', async () => {
    mockFetch({
      'GET /api/member/weekly-report/current': () => ({ body: current({ canEdit: false, isLate: true, report: { weekStart: '2026-11-09', contacted: 4, needHelp: 0, prayerNeeds: null, note: null, late: false, submittedAt: '2026-11-15T10:00:00Z' } }) }),
      'GET /api/member/weekly-report/history': () => ({ body: { items: [] } }),
    });
    render(<WeeklyReportForm />);
    expect(await screen.findByText(/Sent on time/)).toBeInTheDocument();
    expect(screen.getByText(/can no longer be changed/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update my report' })).toBeDisabled();
  });
});

const B = '/api/member/central-weekly-reports';
const overview = {
  dueWeek: '2026-11-09',
  deadline: future,
  counts: { GREEN: 1, YELLOW: 1, RED: 1, NEW: 0 },
  leaders: [
    { personId: 'r', name: 'Red Leader', generations: [1], assemblies: ['Alpha'], colour: 'RED', missedOfLast4: 2, lastReportWeek: null, lastReportLate: false },
    { personId: 'y', name: 'Yellow Leader', generations: [2], assemblies: ['Beta'], colour: 'YELLOW', missedOfLast4: 0, lastReportWeek: '2026-11-09', lastReportLate: true },
    { personId: 'g', name: 'Green Leader', generations: [1], assemblies: ['Alpha'], colour: 'GREEN', missedOfLast4: 0, lastReportWeek: '2026-11-09', lastReportLate: false },
  ],
};

describe('LeadersReportPanel (the central admin)', () => {
  it('shows every leader with a colour and the counts, opens their reports, and reminds the late ones', async () => {
    mockFetch({
      [`GET ${B}/overview`]: () => ({ body: overview }),
      [`GET ${B}/summaries`]: () => ({ body: { items: [{ generation: 1, weekStart: '2026-11-09', summary: 'All is well', representativeName: 'Rita Rep' }] } }),
      [`GET ${B}/leaders/r`]: () => ({ body: { name: 'Red Leader', assemblies: ['Alpha'], reports: [{ weekStart: '2026-11-02', contacted: 9, needHelp: 2, prayerNeeds: 'Peace', note: 'ok', late: false }] } }),
      [`POST ${B}/remind`]: () => ({ body: { reminded: 1 } }),
    });
    render(<LeadersReportPanel base={B} mode="admin" />);
    const rows = await screen.findAllByTestId('leader-row');
    expect(rows.map((r) => within(r).getByText(/Leader$/).textContent)).toEqual(['Red Leader', 'Yellow Leader', 'Green Leader']);
    expect(within(rows[0]).getByRole('img', { name: 'Missed' })).toBeInTheDocument();
    expect(within(rows[0]).getByText(/missed 2 of the last 4 weeks/)).toBeInTheDocument();
    expect(within(rows[2]).getByRole('img', { name: 'Sent on time' })).toBeInTheDocument();
    expect(screen.getByTestId('report-counts')).toHaveTextContent('1 on time');
    expect(screen.getByTestId('report-counts')).toHaveTextContent('1 missed');

    fireEvent.click(within(rows[0]).getByRole('button', { name: /Red Leader/ }));
    const entry = await screen.findByTestId('report-entry');
    expect(entry).toHaveTextContent('9 contacted · 2 need help');
    expect(entry).toHaveTextContent('Peace');
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Send a reminder' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Reminder sent to 1 leader.');
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ personIds: ['r'] });
    fireEvent.click(screen.getByRole('button', { name: 'Remind everyone who is late' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST').pop()?.body).toEqual({ allLate: true }));
    expect(screen.getByTestId('rep-summaries')).toHaveTextContent('All is well');
  });

  it('filters by generation', async () => {
    mockFetch({ [`GET ${B}/overview`]: () => ({ body: overview }), [`GET ${B}/summaries`]: () => ({ body: { items: [] } }) });
    render(<LeadersReportPanel base={B} mode="admin" />);
    await screen.findAllByTestId('leader-row');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '2' } });
    await waitFor(() => expect(calls.some((c) => c.url === `${B}/overview?generation=2`)).toBe(true));
  });
});

describe('LeadersReportPanel (a representative)', () => {
  it('writes the weekly summary for the central admin and has no summaries list', async () => {
    const R = '/api/member/rep-weekly-reports';
    mockFetch({
      [`GET ${R}/overview`]: () => ({ body: overview }),
      [`GET ${R}/summary`]: () => ({ body: { generation: 1, weekStart: '2026-11-09', weekEnd: '2026-11-15', summary: '', sent: false } }),
      [`PUT ${R}/summary`]: () => ({ body: { generation: 1, weekStart: '2026-11-09', weekEnd: '2026-11-15', summary: 'Two need encouragement', sent: true } }),
    });
    render(<LeadersReportPanel base={R} mode="rep" />);
    const form = await screen.findByTestId('rep-summary');
    expect(screen.queryByTestId('rep-summaries')).toBeNull();
    const send = within(form).getByRole('button', { name: 'Send my summary' });
    expect(send).toBeDisabled();
    fireEvent.change(within(form).getByRole('textbox'), { target: { value: 'Two need encouragement' } });
    fireEvent.click(send);
    expect(await screen.findByRole('status')).toHaveTextContent('Summary saved.');
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ summary: 'Two need encouragement' });
    expect(within(form).getByRole('button', { name: 'Update my summary' })).toBeInTheDocument();
  });
});
