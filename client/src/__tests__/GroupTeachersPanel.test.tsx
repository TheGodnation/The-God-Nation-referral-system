import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { GroupTeachersPanel } from '../components/admin/GroupTeachersPanel';
import { TeachingTodayStrip } from '../components/chat/TeachingTodayStrip';

const json = (body: unknown, status = 200) => Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => body });
afterEach(() => vi.unstubAllGlobals());

const row = (over: Record<string, unknown> = {}) => ({ id: 't1', personId: 'p1', name: 'Alpha Tester', language: 'en', communityId: 'g1', communityName: 'Headquarters Assembly', days: [], ...over });

describe('Teachers (central admin)', () => {
  it('says there is no teacher yet, and the add button waits for a member and a group', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ teachers: [] })));
    render(<GroupTeachersPanel />);
    expect(await screen.findByTestId('gt-empty')).toBeInTheDocument();
    expect(screen.getByTestId('gt-add')).toBeDisabled();
  });

  it('finds a member and a group by name, adds the teacher, and lists them under the group', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'POST') {
        calls.push(`POST ${init?.body}`);
        return json({ teachers: [row()] });
      }
      if (url.includes('/members?search=')) return json({ items: [{ id: 'p1', name: 'Alpha Tester', language: 'en', hasAccount: true }, { id: 'p2', name: 'Alpha NoAccount', language: 'en', hasAccount: false }], note: null });
      if (url.includes('/groups?search=')) return json({ items: [{ id: 'g1', name: 'Headquarters Assembly', kind: 'ASSEMBLY' }] });
      return json({ teachers: [] });
    }));
    render(<GroupTeachersPanel />);
    fireEvent.change(await screen.findByTestId('gt-member-input'), { target: { value: 'Alpha' } });
    const results = await screen.findAllByTestId('gt-member-result');
    expect(results).toHaveLength(1); // someone with no app account cannot be chosen
    fireEvent.click(results[0]);
    fireEvent.change(screen.getByTestId('gt-group-input'), { target: { value: 'Head' } });
    fireEvent.click(await screen.findByTestId('gt-group-result'));
    fireEvent.click(screen.getByTestId('gt-add'));
    expect(await screen.findByTestId('gt-row-t1')).toHaveTextContent('Alpha Tester');
    expect(screen.getByTestId('gt-group')).toHaveTextContent('Headquarters Assembly');
    expect(calls).toEqual(['POST {"personId":"p1","communityId":"g1"}']);
  });

  it('adds a weekly day and a one-date day, shows both in words, and removes one', async () => {
    const calls: string[] = [];
    let current = row();
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'POST') {
        calls.push(`POST ${init?.body}`);
        current = row({ days: [{ id: 'd1', dayOfWeek: 3, date: null, time: '07:00' }, { id: 'd2', dayOfWeek: null, date: '2026-12-10', time: '18:30' }] });
        return json({ teachers: [current] });
      }
      if (method === 'DELETE') {
        calls.push('DELETE');
        return json({ teachers: [row({ days: [{ id: 'd2', dayOfWeek: null, date: '2026-12-10', time: '18:30' }] })] });
      }
      return json({ teachers: [current] });
    }));
    render(<GroupTeachersPanel />);
    await screen.findByTestId('gt-row-t1');
    expect(screen.getByText(/No teaching day yet/)).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('day-weekday'), { target: { value: '3' } });
    fireEvent.change(screen.getByTestId('day-time'), { target: { value: '07:00' } });
    fireEvent.click(screen.getByTestId('day-add'));
    await waitFor(() => expect(screen.getAllByTestId('gt-day')).toHaveLength(2));
    expect(screen.getAllByTestId('gt-day')[0]).toHaveTextContent('Every Wednesday at 07:00');
    expect(screen.getAllByTestId('gt-day')[1]).toHaveTextContent('10 December');
    expect(calls[0]).toBe('POST {"dayOfWeek":3,"time":"07:00"}');
    // a one-date day needs a date first
    fireEvent.click(screen.getByTestId('day-kind-date'));
    expect(screen.getByTestId('day-add')).toBeDisabled();
    fireEvent.change(screen.getByTestId('day-date'), { target: { value: '2026-12-10' } });
    fireEvent.click(screen.getByTestId('day-add'));
    await waitFor(() => expect(calls[1]).toBe('POST {"date":"2026-12-10","time":"07:00"}'));
    fireEvent.click(within(screen.getAllByTestId('gt-day')[0]).getByText('×'));
    await waitFor(() => expect(screen.getAllByTestId('gt-day')).toHaveLength(1));
  });

  it('asks before taking a teacher off a group', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') calls.push('DELETE');
      return json({ teachers: [row()] });
    }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<GroupTeachersPanel />);
    fireEvent.click(await screen.findByTestId('gt-remove'));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Alpha Tester'));
    expect(calls).toEqual([]);
    confirm.mockRestore();
  });
});

describe('Teaching today (group chat)', () => {
  it('shows nothing on a day without a teaching', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ items: [] })));
    render(<TeachingTodayStrip communityId="g1" />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByTestId('teaching-today')).toBeNull();
  });

  it('names who teaches today and when, in Cameroon time, and marks one that is over', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ items: [{ name: 'Alpha Tester', startsAt: '2026-12-02T06:00:00.000Z', passed: true }, { name: 'Beta Tester', startsAt: '2026-12-02T17:00:00.000Z', passed: false }] })));
    render(<TeachingTodayStrip communityId="g1" />);
    const strip = await screen.findByTestId('teaching-today');
    expect(strip).toHaveTextContent('Teaching today:');
    expect(strip).toHaveTextContent('Alpha Tester at 07:00 (earlier today)');
    expect(strip).toHaveTextContent('Beta Tester at 18:00');
    expect(strip).toHaveTextContent('Cameroon time');
  });
});
