import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { TeachingCompletionPanel } from '../components/admin/TeachingCompletionPanel';

// Who did the teachings: people who handed in the quiz, "did" kept apart from "passed", filtered by "all" or "at
// least N", a spreadsheet link, and a confirmed "make leader".
const json = (body: unknown, status = 200) => Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => body });
afterEach(() => vi.unstubAllGlobals());

const T = ['t1', 't2', 't3'].map((id, i) => ({ id, title: `Teaching ${i + 1}`, titleTranslated: null, detectedLanguage: 'en', assemblyName: 'HQ', passMark: 70 }));
const completion = {
  teachings: T,
  tookAll: 1,
  tookAny: 3,
  people: [
    { personId: 'p1', name: 'Did All', whatsappNumber: '+237600000001', took: 3, passed: 2, leads: [], memberOf: [{ id: 'a1', name: 'HQ' }], results: { t1: { percentage: 90, passed: true }, t2: { percentage: 40, passed: false }, t3: { percentage: 70, passed: true } } },
    { personId: 'p2', name: 'Did Two', whatsappNumber: '+237600000002', took: 2, passed: 1, leads: ['HQ'], memberOf: [{ id: 'a1', name: 'HQ' }], results: { t1: { percentage: 100, passed: true }, t2: null, t3: { percentage: 20, passed: false } } },
    { personId: 'p3', name: 'Did One', whatsappNumber: '+237600000003', took: 1, passed: 0, leads: [], memberOf: [], results: { t1: null, t2: { percentage: 30, passed: false }, t3: null } },
  ],
};

function stub(calls: { url: string; method: string; body?: any }[]) {
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.includes('/assemblies')) return json({ items: [{ id: 'a1', name: 'HQ', teachings: 3 }] });
    if (init?.method === 'POST' && url.endsWith('/appoint')) return json({ id: 'r1' }, 201);
    return json(completion);
  }));
}

describe('Who did the teachings', () => {
  it('shows only those who did all the teachings first, with the counts, and keeps did apart from passed', async () => {
    stub([]);
    render(<TeachingCompletionPanel base="/api/member/central-teaching-completion" />);
    expect(await screen.findByTestId('completion-summary')).toHaveTextContent('1 did all 3 teachings. 3 did at least one.');
    expect(screen.getByTestId('completion-shown')).toHaveTextContent('1 people shown');
    const row = screen.getByTestId('completion-person-p1');
    expect(row).toHaveTextContent('Did 3 of 3');
    expect(row).toHaveTextContent('passed 2');
    // The teaching he did but did not pass is still shown as done.
    expect(within(row).getByTitle('Teaching 2: 40% not passed')).toHaveTextContent('40%');
    expect(screen.queryByTestId('completion-person-p2')).not.toBeInTheDocument();
  });

  it('can show those who did at least a number, or anyone who did any, and offers the spreadsheet', async () => {
    stub([]);
    render(<TeachingCompletionPanel base="/api/admin/teaching-completion" />);
    await screen.findByTestId('completion-summary');
    fireEvent.click(screen.getByLabelText('Everyone who did any'));
    expect(screen.getByTestId('completion-shown')).toHaveTextContent('3 people shown');
    fireEvent.click(screen.getByLabelText('Those who did at least'));
    fireEvent.change(screen.getByLabelText('Those who did at least', { selector: 'input[inputmode]' }), { target: { value: '2' } });
    expect(screen.getByTestId('completion-shown')).toHaveTextContent('2 people shown');
    expect(screen.queryByTestId('completion-person-p3')).not.toBeInTheDocument();
    expect(screen.getByTestId('completion-person-p2')).toBeInTheDocument();
    expect(screen.getByTestId('completion-export')).toHaveAttribute('href', '/api/admin/teaching-completion/export?communityId=a1');
  });

  it('makes someone a leader only after confirming, and says when they already lead the assembly', async () => {
    const calls: { url: string; method: string; body?: any }[] = [];
    stub(calls);
    render(<TeachingCompletionPanel base="/api/member/central-teaching-completion" />);
    await screen.findByTestId('completion-summary');
    fireEvent.click(screen.getByLabelText('Everyone who did any'));
    // Someone who already leads this assembly has no button.
    expect(within(screen.getByTestId('completion-person-p2')).getByText('Leader here')).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId('completion-person-p1')).getByTestId('completion-appoint'));
    expect(calls.some((c) => c.url.endsWith('/appoint'))).toBe(false); // nothing happens before the confirmation
    fireEvent.click(screen.getByTestId('completion-appoint-confirm'));
    await waitFor(() => expect(calls.find((c) => c.url.endsWith('/appoint'))?.body).toEqual({ personId: 'p1', communityId: 'a1' }));
    expect(await screen.findByText('Did All is now a leader.')).toBeInTheDocument();
  });
});
