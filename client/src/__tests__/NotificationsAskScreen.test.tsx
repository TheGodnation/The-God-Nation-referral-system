import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const push = vi.hoisted(() => ({ status: 'not_subscribed' as string, enable: vi.fn() }));
vi.mock('../lib/push', () => ({
  checkPushOnThisDevice: async () => push.status,
  enablePushNotifications: (...a: unknown[]) => push.enable(...a),
  prefetchPushKey: async () => ({ configured: true, publicKey: 'k' }),
}));

import { NotificationsAskScreen, ASK_AGAIN_AFTER_MS } from '../components/member/NotificationsAskScreen';

beforeEach(() => {
  localStorage.clear();
  push.status = 'not_subscribed';
  push.enable.mockReset();
});

describe('Asking to turn on notifications (full screen)', () => {
  it('shows what the member will be told about, with one big button, then hides once notifications are on', async () => {
    push.enable.mockResolvedValue({ ok: true });
    render(<NotificationsAskScreen />);
    const dialog = await screen.findByTestId('notify-ask');
    expect(dialog).toHaveTextContent('Stay connected to your family');
    expect(dialog).toHaveTextContent('Messages');
    expect(dialog).toHaveTextContent('Your assemblies, groups and private messages');
    expect(dialog).toHaveTextContent('Teachings');
    expect(dialog).toHaveTextContent('Reminders');
    expect(dialog).toHaveTextContent('Programs');
    expect(dialog).not.toHaveTextContent('Instructions');
    expect(dialog).toHaveTextContent('Then tap “Allow”');
    fireEvent.click(screen.getByTestId('notify-ask-yes'));
    await waitFor(() => expect(screen.queryByTestId('notify-ask')).toBeNull());
    expect(push.enable).toHaveBeenCalledTimes(1);
  });

  it('"Not now" closes it, and it does not come back for a week', async () => {
    const { unmount } = render(<NotificationsAskScreen />);
    fireEvent.click(await screen.findByTestId('notify-ask-later'));
    expect(screen.queryByTestId('notify-ask')).toBeNull();
    unmount();
    render(<NotificationsAskScreen />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('notify-ask')).toBeNull();
  });

  it('comes back a week after "Not now" while notifications are still off', async () => {
    localStorage.setItem('godnation:notifyAsk:last', String(Date.now() - ASK_AGAIN_AFTER_MS - 1000));
    render(<NotificationsAskScreen />);
    expect(await screen.findByTestId('notify-ask')).toBeInTheDocument();
  });

  it('never shows when notifications are already on, or when the phone cannot turn them on here', async () => {
    push.status = 'subscribed';
    const { unmount } = render(<NotificationsAskScreen />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('notify-ask')).toBeNull();
    unmount();
    push.status = 'denied';
    render(<NotificationsAskScreen />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('notify-ask')).toBeNull();
  });

  it('says so when it could not finish, and lets the member try again', async () => {
    push.enable.mockResolvedValue({ ok: false, reason: 'failed' });
    render(<NotificationsAskScreen />);
    fireEvent.click(await screen.findByTestId('notify-ask-yes'));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByTestId('notify-ask')).toBeInTheDocument();
  });
});
