import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GrowthPanel } from '../components/admin/GrowthPanel';

// The growth report shows how many members will actually get phone notifications.
afterEach(() => vi.unstubAllGlobals());
const TOTALS = { visitors: 0, leads: 0, registered: 0, confirmed: 0, profileCompleted: 0, joinedGroup: 0, saysJoined: 0, firstChat: 0, firstExam: 0, returned7: 0, returned30: 0 };
// Only the growth report answers; the other cards on the page (reminders, ads...) get "not found" like in the other growth tests.
const mock = (notifications?: unknown) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const isGrowth = String(url).includes('/api/admin/growth');
      const body = isGrowth ? { days: 30, totals: TOTALS, bySource: [], byAmbassador: [], byPlatform: [], truncated: false, notifications } : { error: 'not found' };
      return { ok: isGrowth, status: isGrowth ? 200 : 404, headers: { get: () => 'application/json' }, json: async () => body };
    }),
  );

describe('Notifications on (growth report)', () => {
  it('shows how many members have notifications on, out of all members, with the percentage', async () => {
    mock({ totalMembers: 200, membersWithPush: 50, subscriptions: 64 });
    render(<GrowthPanel base="/api/admin/growth" />);
    expect(await screen.findByTestId('growth-notifications')).toHaveTextContent('Members with phone notifications on');
    expect(screen.getByTestId('growth-notifications-count')).toHaveTextContent('50 of 200 members');
    expect(screen.getByTestId('growth-notifications-percent')).toHaveTextContent('25%');
    expect(screen.getByTestId('growth-notifications')).toHaveTextContent('64 phones in all');
  });

  it('shows no card, and no division by zero, when there are no members or the server sends nothing', async () => {
    mock({ totalMembers: 0, membersWithPush: 0, subscriptions: 0 });
    const a = render(<GrowthPanel base="/api/admin/growth" />);
    await screen.findByTestId('growth-notifications');
    expect(screen.queryByTestId('growth-notifications-percent')).toBeNull();
    a.unmount();
    mock(undefined);
    render(<GrowthPanel base="/api/admin/growth" />);
    await screen.findByTestId('growth-total-registered');
    expect(screen.queryByTestId('growth-notifications')).toBeNull();
  });
});
