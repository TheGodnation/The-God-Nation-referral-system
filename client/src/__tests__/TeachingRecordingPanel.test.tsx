import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TeachingRecordingPanel } from '../components/teaching/TeachingRecordingPanel';

const json = (body: unknown, status = 200) => Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => body });
afterEach(() => vi.unstubAllGlobals());

const week = (recording: unknown, over = {}) => ({ weekStart: '2026-11-23', postsAt: '2026-11-23T06:00:00.000Z', canChange: true, recording, ...over });
const data = (w: unknown, over = {}) => ({ enabled: true, isTeacher: true, groupChosen: true, weeks: [w], ...over });
const rec = (over = {}) => ({ status: 'TEXT_READY', spokenLanguage: 'fr', transcript: 'Bonjour a tous', translated: '', audioUrl: 'https://x/a.mp3', ...over });

describe('Record my teaching ahead of time', () => {
  it('shows nothing to someone who is not a teacher', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json(data(week(null), { isTeacher: false }))));
    render(<TeachingRecordingPanel />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByTestId('recording-panel')).toBeNull();
  });

  it('offers to record, and says when it will be posted in Cameroon time', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json(data(week(null)))));
    render(<TeachingRecordingPanel />);
    expect(await screen.findByTestId('recording-start')).toBeInTheDocument();
    expect(screen.getByTestId('recording-23'.replace('23', '2026-11-23'))).toHaveTextContent('07:00');
  });

  it('explains when no group is chosen and when the time has passed', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json(data(week(null, { canChange: false }), { groupChosen: false }))));
    render(<TeachingRecordingPanel />);
    expect(await screen.findByText(/No group is chosen/)).toBeInTheDocument();
    expect(screen.queryByTestId('recording-start')).toBeNull();
  });

  it('shows the text in the language spoken, saves corrections and approves', async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method !== 'GET') calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url.endsWith('/transcript')) return json(week(rec({ transcript: 'Bonjour à tous' })));
      if (url.endsWith('/approve')) return json(week(rec({ status: 'APPROVED', transcript: 'Bonjour à tous' })));
      return json(data(week(rec())));
    }));
    render(<TeachingRecordingPanel />);
    const box = (await screen.findByTestId('recording-text')) as HTMLTextAreaElement;
    expect(screen.getByText('Text of your teaching in Français')).toBeInTheDocument();
    expect(box.value).toBe('Bonjour a tous');
    fireEvent.change(box, { target: { value: 'Bonjour à tous' } });
    fireEvent.click(screen.getByTestId('recording-approve'));
    expect(await screen.findByTestId('recording-approved')).toHaveTextContent('Approved');
    expect(calls.map((c) => c.url.split('/recordings/')[1])).toEqual(['2026-11-23/transcript', '2026-11-23/approve']);
    expect(calls[0].body).toEqual({ text: 'Bonjour à tous' });
  });

  it('says the text is being written, and lets a failed one be tried again', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json(data(week(rec({ status: 'WRITING', transcript: '' }))))));
    const { unmount } = render(<TeachingRecordingPanel />);
    expect(await screen.findByTestId('recording-writing')).toBeInTheDocument();
    unmount();
    vi.stubGlobal('fetch', vi.fn(() => json(data(week(rec({ status: 'FAILED', transcript: '' }))))));
    render(<TeachingRecordingPanel />);
    expect(await screen.findByTestId('recording-failed')).toBeInTheDocument();
    expect(screen.getByTestId('recording-retry')).toBeInTheDocument();
    expect(screen.getByTestId('recording-text')).toBeInTheDocument(); // can type it by hand
  });

  it('says it has been posted once it is out', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json(data(week(rec({ status: 'POSTED' }), { canChange: false })))));
    render(<TeachingRecordingPanel />);
    expect(await screen.findByTestId('recording-posted')).toBeInTheDocument();
    expect(screen.queryByTestId('recording-delete')).toBeNull();
  });

  it('uploads a chosen file and sends it for writing', async () => {
    const calls: { url: string; method: string }[] = [];
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }));
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method });
      if (url.endsWith('/authorize')) return json({ storageKey: 'k1', uploadUrl: 'https://upload.test/k1' });
      if (url === 'https://upload.test/k1') return Promise.resolve({ ok: true, status: 200, headers: { get: () => null } });
      if (method === 'POST') return json(week(rec({ status: 'RECORDED', transcript: '' })));
      return json(data(week(null)));
    }));
    render(<TeachingRecordingPanel />);
    const input = await screen.findByTestId('recording-file');
    fireEvent.change(input, { target: { files: [new File(['abc'], 'a.mp3', { type: 'audio/mpeg' })] } });
    fireEvent.click(await screen.findByTestId('recording-use'));
    expect(await screen.findByTestId('recording-writing')).toBeInTheDocument();
    expect(calls.filter((c) => c.method !== 'GET').map((c) => c.method + ' ' + c.url.split('/').pop())).toEqual(['POST authorize', 'PUT k1', 'POST recordings']);
  });
});
