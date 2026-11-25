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
    // Two requests one after the other: give it time when the whole suite runs at once.
    expect(await screen.findByTestId('recording-approved', {}, { timeout: 4000 })).toHaveTextContent('Approved');
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

  it('records the next part in order: the file goes to the parts address, its text comes on its own card, and the guide says what is next', async () => {
    const calls: string[] = [];
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }));
    const p1 = { id: null, n: 1, audioUrl: 'https://x/1.mp3', state: 'approved', transcript: 'Partie un', translated: 'Part one' };
    const p2 = { id: '11111111-1111-4111-8111-111111111111', n: 2, audioUrl: 'https://x/2.mp3', state: 'writing', transcript: '', translated: '' };
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method !== 'GET') calls.push(`${method} ${url.split('/').slice(-2).join('/')}`);
      if (url.endsWith('/authorize')) return json({ storageKey: 'k2', uploadUrl: 'https://upload.test/k2' });
      if (url === 'https://upload.test/k2') return Promise.resolve({ ok: true, status: 200, headers: { get: () => null } });
      if (url.endsWith('/recordings/parts')) return json(week(rec({ status: 'APPROVED', parts: [p1, p2] })));
      return json(data(week(rec({ status: 'APPROVED', parts: [p1] }))));
    }));
    render(<TeachingRecordingPanel />);
    expect(await screen.findByTestId('recording-start')).toHaveTextContent('Record part 2');
    expect(screen.getByTestId('recording-guide')).toHaveTextContent('Part 1 is ready. Record part 2');
    expect(screen.getByTestId('recording-part-1')).toHaveTextContent('Approved');
    fireEvent.change(screen.getByTestId('recording-file'), { target: { files: [new File(['abc'], 'b.mp3', { type: 'audio/mpeg' })] } });
    expect(screen.getByTestId('recording-use')).toHaveTextContent('Use this as part 2');
    fireEvent.click(screen.getByTestId('recording-use'));
    expect(await screen.findByTestId('recording-part-2')).toHaveTextContent('Writing the text');
    expect(calls).toEqual(['POST recordings/authorize', 'PUT upload.test/k2', 'POST recordings/parts']);
    // While part 2 is being written, part 3 can already be recorded.
    expect(screen.getByTestId('recording-start')).toHaveTextContent('Record part 3');
    expect(screen.getByTestId('recording-guide')).toHaveTextContent('part 2 is being written');
  });

  it("corrects and approves a later part on its own card, at that part's own address", async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    const id = '22222222-2222-4222-8222-222222222222';
    const p1 = { id: null, n: 1, audioUrl: 'https://x/1.mp3', state: 'approved', transcript: 'Un', translated: 'One' };
    const p2 = (over = {}) => ({ id, n: 2, audioUrl: 'https://x/2.mp3', state: 'ready', transcript: 'Deux', translated: '', ...over });
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method !== 'GET') calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url.endsWith(`/parts/${id}/transcript`)) return json(week(rec({ status: 'APPROVED', parts: [p1, p2({ transcript: 'Deux, amen' })] })));
      if (url.endsWith(`/parts/${id}/approve`)) return json(week(rec({ status: 'APPROVED', parts: [p1, p2({ state: 'approved', transcript: 'Deux, amen' })] })));
      return json(data(week(rec({ status: 'APPROVED', parts: [p1, p2()] }))));
    }));
    render(<TeachingRecordingPanel />);
    const card = await screen.findByTestId('recording-part-2');
    expect(screen.getByTestId('recording-guide')).toHaveTextContent('Check and approve the text of part 2 above, then record part 3');
    const box = card.querySelector('textarea')!;
    fireEvent.change(box, { target: { value: 'Deux, amen' } });
    fireEvent.click(card.querySelector('[data-testid="recording-approve"]')!);
    await waitFor(() => expect(screen.getByTestId('recording-part-2')).toHaveTextContent('Approved'));
    expect(calls.map((c) => `${c.method} ${c.url.split('/recordings/')[1]}`)).toEqual([`PUT 2026-11-23/parts/${id}/transcript`, `POST 2026-11-23/parts/${id}/approve`]);
    expect(calls[0].body).toEqual({ text: 'Deux, amen' });
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

  it('says when the words of a part could not be written, offers to write them again, and lets a part be removed', async () => {
    const calls: string[] = [];
    const id = '33333333-3333-4333-8333-333333333333';
    const p1 = { id: null, n: 1, audioUrl: 'https://x/1.mp3', state: 'ready', transcript: 'Un', translated: '' };
    const p2 = { id, n: 2, audioUrl: 'https://x/2.mp3', state: 'failed', transcript: '', translated: '' };
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method !== 'GET') calls.push(`${method} ${url.split('/recordings/')[1]}`);
      if (method === 'DELETE') return json(week(rec({ parts: [p1] })));
      return json(data(week(rec({ parts: [p1, p2] }))));
    }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<TeachingRecordingPanel />);
    const card = await screen.findByTestId('recording-part-2');
    expect(card).toHaveTextContent('could not be written');
    expect(card.querySelector('[data-testid="recording-retry"]')).not.toBeNull();
    expect(screen.getByTestId('recording-part-1').querySelector('[data-testid="recording-remove-part"]')).toBeNull(); // part 1 is removed with Start over
    fireEvent.click(card.querySelector('[data-testid="recording-remove-part"]')!);
    expect(confirm).toHaveBeenCalledWith('Remove part 2?');
    await waitFor(() => expect(screen.queryByTestId('recording-part-2')).toBeNull());
    expect(calls).toEqual([`DELETE 2026-11-23/parts/${id}`]);
    confirm.mockRestore();
  });

  it('an older part whose words are already in part 1 says so, with nothing to correct, and the next part comes after it', async () => {
    const p1 = { id: null, n: 1, audioUrl: 'https://x/1.mp3', state: 'approved', transcript: 'Un\n\nDeux', translated: 'One\n\nTwo' };
    const p2 = { id: '44444444-4444-4444-8444-444444444444', n: 2, audioUrl: 'https://x/2.mp3', state: 'approved', transcript: '', translated: '', inFirstPart: true };
    vi.stubGlobal('fetch', vi.fn(() => json(data(week(rec({ status: 'APPROVED', parts: [p1, p2] }))))));
    render(<TeachingRecordingPanel />);
    const card = await screen.findByTestId('recording-part-2');
    expect(card).toHaveTextContent('already in the text of part 1');
    expect(card.querySelector('textarea')).toBeNull();
    expect(screen.getByTestId('recording-start')).toHaveTextContent('Record part 3');
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
