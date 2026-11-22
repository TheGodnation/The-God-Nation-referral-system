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

  it('adds more to an existing recording: the file goes to the parts address, the earlier parts stay, and each part can be played', async () => {
    const calls: string[] = [];
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }));
    const two = { parts: [{ audioUrl: 'https://x/1.mp3' }, { audioUrl: 'https://x/2.mp3' }], partsWithoutText: 0 };
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method !== 'GET') calls.push(`${method} ${url.split('/').slice(-2).join('/')}`);
      if (url.endsWith('/authorize')) return json({ storageKey: 'k2', uploadUrl: 'https://upload.test/k2' });
      if (url === 'https://upload.test/k2') return Promise.resolve({ ok: true, status: 200, headers: { get: () => null } });
      if (url.endsWith('/recordings/parts')) return json(week(rec({ status: 'WRITING', ...two })));
      return json(data(week(rec({ parts: [{ audioUrl: 'https://x/1.mp3' }] }))));
    }));
    render(<TeachingRecordingPanel />);
    expect(await screen.findByTestId('recording-start')).toHaveTextContent('Add more');
    expect(screen.queryByTestId('recording-parts')).toBeNull(); // one part: a single player
    fireEvent.change(screen.getByTestId('recording-file'), { target: { files: [new File(['abc'], 'b.mp3', { type: 'audio/mpeg' })] } });
    expect(screen.getByTestId('recording-use')).toHaveTextContent('Add to my teaching');
    fireEvent.click(screen.getByTestId('recording-use'));
    expect(await screen.findByTestId('recording-writing')).toBeInTheDocument();
    expect(calls).toEqual(['POST recordings/authorize', 'PUT upload.test/k2', 'POST recordings/parts']);
    expect(await screen.findByTestId('recording-parts')).toHaveTextContent('Part 2');
  });

  it('starting over asks first, and does nothing when the teacher says no', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') calls.push('DELETE');
      return json(data(week(rec())));
    }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<TeachingRecordingPanel />);
    fireEvent.click(await screen.findByTestId('recording-delete'));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('every part'));
    expect(calls).toEqual([]);
    confirm.mockRestore();
  });

  it('says when the words of an added part could not be written, and offers to write them again', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json(data(week(rec({ partsWithoutText: 1 }))))));
    render(<TeachingRecordingPanel />);
    expect(await screen.findByTestId('recording-parts-failed')).toHaveTextContent('one part');
    expect(screen.getByTestId('recording-retry')).toBeInTheDocument();
  });

  it('pauses and continues the same recording, and only stops when told to', async () => {
    const states: string[] = [];
    class FakeRecorder {
      static isTypeSupported = () => true;
      state = 'inactive';
      mimeType = 'audio/webm';
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      constructor(public stream: unknown) {}
      start() { this.state = 'recording'; states.push('start'); }
      pause() { this.state = 'paused'; states.push('pause'); }
      resume() { this.state = 'recording'; states.push('resume'); }
      stop() { this.state = 'inactive'; states.push('stop'); this.ondataavailable?.({ data: new Blob(['a'], { type: 'audio/webm' }) }); this.onstop?.(); }
    }
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }));
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } });
    vi.stubGlobal('fetch', vi.fn(() => json(data(week(null)))));
    render(<TeachingRecordingPanel />);
    fireEvent.click(await screen.findByTestId('recording-start'));
    fireEvent.click(await screen.findByTestId('recording-pause'));
    expect(screen.getByTestId('recording-live')).toHaveTextContent('Paused');
    fireEvent.click(screen.getByTestId('recording-resume'));
    expect(screen.getByTestId('recording-pause')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('recording-pause'));
    fireEvent.click(screen.getByTestId('recording-stop')); // stopping while paused still keeps everything
    expect(await screen.findByTestId('recording-preview')).toBeInTheDocument();
    expect(states).toEqual(['start', 'pause', 'resume', 'pause', 'stop']);
  });
});
