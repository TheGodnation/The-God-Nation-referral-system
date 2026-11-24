import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WhatsAppCloudCard } from '../components/admin/WhatsAppCloudCard';

// The central admin's switch for the automatic WhatsApp messages.
const json = (body: unknown, status = 200) => Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => body });
afterEach(() => vi.unstubAllGlobals());

const summary = (over = {}) => ({ mode: 'OFF', configured: true, today: { sent: 0, failed: 0, skipped: 0 }, recent: [], ...over });

describe('Automatic WhatsApp messages card', () => {
  it('starts Off, and switching to Test is saved', async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method !== 'GET') calls.push({ url, method, body: JSON.parse(String(init?.body)) });
      return json(method === 'PUT' ? summary({ mode: 'TEST' }) : summary());
    }));
    render(<WhatsAppCloudCard base="/api/admin/whatsapp-cloud" />);
    expect(await screen.findByTestId('whatsapp-cloud-card')).toHaveTextContent('Automatic WhatsApp messages');
    expect(screen.getByRole('radio', { name: /^Off/ })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: /Test/ }));
    await waitFor(() => expect(screen.getByRole('radio', { name: /Test/ })).toBeChecked());
    expect(calls[0]).toEqual({ url: '/api/admin/whatsapp-cloud', method: 'PUT', body: { mode: 'TEST' } });
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });

  it('says it is not set up yet, and cannot send a test, until the server has the token', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json(summary({ configured: false }))));
    render(<WhatsAppCloudCard base="/api/admin/whatsapp-cloud" />);
    expect(await screen.findByTestId('whatsapp-cloud-config')).toHaveTextContent('Not set up yet');
    expect(screen.getByTestId('whatsapp-cloud-test')).toBeDisabled();
  });

  it('explains a refusal when switching on before the setup', async () => {
    vi.stubGlobal('fetch', vi.fn((_u: string, init?: RequestInit) => (init?.method === 'PUT' ? json({ error: 'x', code: 'NOT_CONFIGURED' }, 400) : json(summary()))));
    render(<WhatsAppCloudCard base="/api/admin/whatsapp-cloud" />);
    await screen.findByTestId('whatsapp-cloud-card');
    fireEvent.click(screen.getByRole('radio', { name: /^On/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Not set up yet');
  });

  it('sends the sample message and lists what went out, then shows a refusal plainly', async () => {
    let n = 0;
    vi.stubGlobal('fetch', vi.fn((_u: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        n += 1;
        return n === 1
          ? json(summary({ today: { sent: 1, failed: 0, skipped: 0 }, recent: [{ id: 'r1', at: new Date().toISOString(), to: '+237…222', kind: 'test', status: 'SENT', reason: null }] }))
          : json({ error: '131030: Recipient not in allowed list', code: 'SEND_FAILED' }, 502);
      }
      return json(summary());
    }));
    render(<WhatsAppCloudCard base="/api/admin/whatsapp-cloud" />);
    await screen.findByTestId('whatsapp-cloud-card');
    fireEvent.click(screen.getByTestId('whatsapp-cloud-test'));
    expect(await screen.findByText('Test message sent. Check your WhatsApp.')).toBeInTheDocument();
    expect(screen.getByTestId('whatsapp-cloud-recent')).toHaveTextContent('Test message · +237…222');
    expect(screen.getByTestId('whatsapp-cloud-recent')).toHaveTextContent('Sent');
    expect(screen.getByTestId('whatsapp-cloud-card')).toHaveTextContent('1 sent');
    fireEvent.click(screen.getByTestId('whatsapp-cloud-test'));
    expect(await screen.findByRole('alert')).toHaveTextContent('131030');
  });

  it('sends the test to the typed number, and to the profile number when the box is empty', async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn((_u: string, init?: RequestInit) => {
      if (init?.method === 'POST') bodies.push(JSON.parse(String(init.body)));
      return json(summary());
    }));
    render(<WhatsAppCloudCard base="/api/admin/whatsapp-cloud" />);
    await screen.findByTestId('whatsapp-cloud-card');
    fireEvent.click(screen.getByTestId('whatsapp-cloud-test'));
    await waitFor(() => expect(bodies).toHaveLength(1));
    fireEvent.change(screen.getByTestId('whatsapp-cloud-test-to'), { target: { value: ' +237677000111 ' } });
    fireEvent.click(screen.getByTestId('whatsapp-cloud-test'));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies).toEqual([{}, { to: '+237677000111' }]);
  });
});
