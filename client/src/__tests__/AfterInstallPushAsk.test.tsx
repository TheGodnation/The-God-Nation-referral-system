import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import i18n from '../i18n';

// The first time the app is opened as the installed app, it asks once, clearly, to turn on notifications.
const pushMock = vi.hoisted(() => ({
  status: 'not_subscribed' as string,
  standalone: true,
  enable: vi.fn(async () => ({ ok: true })),
}));
vi.mock('../lib/push', () => ({
  isStandalone: () => pushMock.standalone,
  isIos: () => false,
  checkPushOnThisDevice: async () => pushMock.status,
  enablePushNotifications: (...a: unknown[]) => (pushMock.enable as any)(...a),
}));

import { AfterInstallPushAsk } from '../components/member/AfterInstallPushAsk';

beforeEach(async () => {
  await i18n.changeLanguage('en');
  localStorage.clear();
  pushMock.status = 'not_subscribed';
  pushMock.standalone = true;
  pushMock.enable.mockClear();
  pushMock.enable.mockResolvedValue({ ok: true });
});
afterEach(() => localStorage.clear());

describe('Asking again right after install', () => {
  it('asks once, in the installed app, and turning on ends it for good', async () => {
    const a = render(<AfterInstallPushAsk />);
    expect(await screen.findByTestId('after-install-ask')).toHaveTextContent('The app is installed. One last step.');
    fireEvent.click(screen.getByTestId('after-install-enable'));
    await waitFor(() => expect(screen.queryByTestId('after-install-ask')).toBeNull());
    expect(pushMock.enable).toHaveBeenCalledTimes(1);
    a.unmount();
    render(<AfterInstallPushAsk />);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId('after-install-ask')).toBeNull();
  });

  it('"Not now" closes it for good', async () => {
    const a = render(<AfterInstallPushAsk />);
    fireEvent.click(await screen.findByTestId('after-install-later'));
    expect(screen.queryByTestId('after-install-ask')).toBeNull();
    a.unmount();
    render(<AfterInstallPushAsk />);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId('after-install-ask')).toBeNull();
  });

  it('does not show in a browser tab, when notifications are already on, or when this phone cannot turn them on', async () => {
    pushMock.standalone = false;
    const a = render(<AfterInstallPushAsk />);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId('after-install-ask')).toBeNull();
    a.unmount();

    pushMock.standalone = true;
    pushMock.status = 'subscribed';
    const b = render(<AfterInstallPushAsk />);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId('after-install-ask')).toBeNull();
    b.unmount();

    localStorage.clear();
    pushMock.status = 'denied';
    render(<AfterInstallPushAsk />);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId('after-install-ask')).toBeNull();
  });

  it('speaks French, and keeps asking next time if turning on failed', async () => {
    await i18n.changeLanguage('fr');
    pushMock.enable.mockResolvedValue({ ok: false, reason: 'failed' } as any);
    render(<AfterInstallPushAsk />);
    expect(await screen.findByText(/L’application est installée\. Une dernière étape\./)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('after-install-enable'));
    await waitFor(() => expect(pushMock.enable).toHaveBeenCalled());
    expect(screen.getByTestId('after-install-ask')).toBeInTheDocument();
  });
});
