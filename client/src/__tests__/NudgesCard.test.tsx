import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RemindersCard } from '../components/admin/RemindersCard';
import i18n from '../i18n';

// The admin switch for phone and in-app nudges (days 3 and 7), with the safety rules written out, next to the email reminders.
const calls: { method: string; body: any }[] = [];
const KINDS = { FINISH_SIGNUP_1: 0, FINISH_SIGNUP_2: 0, FINISH_PROFILE: 0, WINBACK: 0 };
const SUMMARY = {
  enabled: false, quietDays: 7, dailyCap: 40, emailConfigured: true, sentToday: 0, last7: KINDS, pending: KINDS,
  nudges: { enabled: false, pending: { NUDGE_DAY3: 12, NUDGE_DAY7: 4 }, last7: { NUDGE_DAY3: 5, NUDGE_DAY7: 1 }, sentToday: 2 },
};
function mock(summary: unknown = SUMMARY) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, body: init?.body ? JSON.parse(init.body as string) : undefined });
      const body = method === 'PUT' ? { ...(summary as object), nudges: { ...(summary as any).nudges, enabled: true } } : summary;
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body };
    }),
  );
}
beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
});

describe('Phone and in-app nudges', () => {
  it('shows the counts and the safety rules, and switching them on is saved', async () => {
    mock();
    render(<RemindersCard base="/api/admin/reminders" />);
    const section = await screen.findByTestId('nudges-section');
    expect(section).toHaveTextContent('Phone and in-app nudges (days 3 and 7)');
    expect(screen.getByTestId('nudge-pending-NUDGE_DAY3')).toHaveTextContent('12 waiting now, 5 sent in the last 7 days');
    expect(screen.getByTestId('nudge-pending-NUDGE_DAY7')).toHaveTextContent('4 waiting now, 1 sent in the last 7 days');
    expect(section).toHaveTextContent('Never within 2 days of the person being in the app.');
    expect(section).toHaveTextContent('At most 4 in all for each person.');
    expect(section).toHaveTextContent('Only between 8:00 and 19:00 Cameroon time');
    expect((screen.getByTestId('nudges-enabled') as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByTestId('nudges-enabled'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ nudgesEnabled: true }));
  });

  it('is absent (and the old save body unchanged) when the server does not offer nudges', async () => {
    mock({ ...SUMMARY, nudges: undefined });
    render(<RemindersCard base="/api/admin/reminders" />);
    await screen.findByTestId('reminders-card');
    expect(screen.queryByTestId('nudges-section')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ enabled: false, quietDays: 7, dailyCap: 40 }));
  });

  it('speaks French', async () => {
    await i18n.changeLanguage('fr');
    mock();
    render(<RemindersCard base="/api/admin/reminders" />);
    expect(await screen.findByText('Rappels sur téléphone et dans l’application (jours 3 et 7)')).toBeInTheDocument();
    expect(screen.getByText('Rappel, jour 3: 12 en attente, 5 envoyés ces 7 derniers jours')).toBeInTheDocument();
  });
});
