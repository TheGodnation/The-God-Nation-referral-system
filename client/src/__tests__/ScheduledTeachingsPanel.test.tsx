import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ScheduledTeachingsPanel } from '../components/admin/ScheduledTeachingsPanel';

// Who is signed in (the quiz tools are for the central admin only).
const who = vi.hoisted(() => ({ member: null as null | { isCentralAdmin: boolean; canTeach: boolean } }));
vi.mock('../lib/MemberAuthContext', () => ({ useMemberAuth: () => ({ member: who.member }) }));

const json = (body: unknown, status = 200) => Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => body });
afterEach(() => {
  vi.unstubAllGlobals();
  who.member = null;
});

const item = (over: Record<string, unknown> = {}) => ({
  id: 's1', communityId: 'g1', communityName: 'Headquarters Assembly', postAt: '2099-11-25T06:00:00.000Z', liveTeaching: false, status: 'TEXT_READY', mode: 'single', spoken: 'fr',
  clips: [{ language: 'fr', audioUrl: 'https://x/a.mp3', textState: 'DONE' }], textEn: '', textFr: 'Le Seigneur est mon berger.', autoTranslated: null, missed: false, canChange: true, postedAt: null, ...over,
});

describe('Scheduled teachings (profile)', () => {
  it('says when nothing is waiting, and how to schedule one', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ items: [] })));
    render(<ScheduledTeachingsPanel />);
    expect(await screen.findByTestId('scheduled-empty')).toHaveTextContent('Send later');
  });

  it('shows the group, the time in Cameroon time, and one box for the language spoken (the other is automatic)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ items: [item()] })));
    render(<ScheduledTeachingsPanel />);
    expect(await screen.findByText('Headquarters Assembly')).toBeInTheDocument();
    expect(screen.getByTestId('scheduled-when')).toHaveTextContent('07:00'); // 06:00 UTC = 07:00 in Cameroon
    expect(screen.getByTestId('scheduled-when')).toHaveTextContent('Cameroon time, GMT+1');
    expect(screen.getByTestId('scheduled-status')).toHaveTextContent('Check the text');
    expect((screen.getByTestId('scheduled-text-fr') as HTMLTextAreaElement).value).toBe('Le Seigneur est mon berger.');
    expect(screen.queryByTestId('scheduled-text-en')).toBeNull(); // never asked to read the other language
  });

  it('shows an English and a French box when both were recorded, with a player for each', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ items: [item({ mode: 'pair', clips: [{ language: 'en', audioUrl: 'https://x/e.mp3', textState: 'DONE' }, { language: 'fr', audioUrl: 'https://x/f.mp3', textState: 'DONE' }], textEn: 'Hello.', textFr: 'Bonjour.' })] })));
    render(<ScheduledTeachingsPanel />);
    expect(await screen.findByTestId('scheduled-text-en')).toBeInTheDocument();
    expect(screen.getByTestId('scheduled-text-fr')).toBeInTheDocument();
    expect(document.querySelectorAll('audio')).toHaveLength(2);
  });

  it('saves a correction and approves, in that order, and says the other language is automatic', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') return json({ items: [item()] });
      calls.push(`${method} ${url.split('/').slice(-1)[0]}${init?.body ? ` ${init.body}` : ''}`);
      if (url.endsWith('/approve')) return json(item({ status: 'APPROVED', textFr: 'Corrigé.', textEn: 'Fixed.', autoTranslated: 'en' }));
      return json(item({ textFr: 'Corrigé.' }));
    }));
    render(<ScheduledTeachingsPanel />);
    fireEvent.change(await screen.findByTestId('scheduled-text-fr'), { target: { value: 'Corrigé.' } });
    fireEvent.click(screen.getByTestId('scheduled-approve'));
    expect(await screen.findByTestId('scheduled-approved')).toHaveTextContent('made automatically');
    expect(calls).toEqual(['PUT text {"textFr":"Corrigé."}', 'POST approve {}']);
  });

  it('says the writing is under way, and when the words of a recording could not be written', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ items: [item({ status: 'WRITING', textFr: '' })] })));
    const first = render(<ScheduledTeachingsPanel />);
    expect(await screen.findByTestId('scheduled-writing')).toBeInTheDocument();
    first.unmount();
    vi.stubGlobal('fetch', vi.fn(() => json({ items: [item({ status: 'FAILED', textFr: '', clips: [{ language: 'fr', audioUrl: 'https://x/a.mp3', textState: 'FAILED' }] })] })));
    render(<ScheduledTeachingsPanel />);
    expect(await screen.findByTestId('scheduled-failed')).toBeInTheDocument();
    expect(screen.getByTestId('scheduled-retry')).toBeInTheDocument();
    expect(screen.getByTestId('scheduled-text-fr')).toBeInTheDocument(); // the words can be typed by hand
  });

  it('warns when the time passed, and "Post it now" and "Delete" ask first', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') return json({ items: [item({ missed: true, postAt: '2020-01-01T06:00:00.000Z' })] });
      calls.push(`${method} ${url.split('/').slice(-1)[0]}`);
      return json({ ok: true });
    }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<ScheduledTeachingsPanel />);
    expect(await screen.findByTestId('scheduled-missed')).toBeInTheDocument();
    expect(screen.getByTestId('scheduled-status')).toHaveTextContent('Time passed');
    fireEvent.click(screen.getByTestId('scheduled-post-now'));
    fireEvent.click(screen.getByTestId('scheduled-delete'));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(calls).toEqual([]); // said no to both
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByTestId('scheduled-delete'));
    await waitFor(() => expect(calls).toEqual(['DELETE s1']));
    await waitFor(() => expect(screen.queryByTestId('scheduled-s1')).toBeNull());
    confirm.mockRestore();
  });

  it('changes the time and the live mark', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') return json({ items: [item()] });
      calls.push(`${method} ${init?.body}`);
      return json(item({ postAt: '2099-12-01T10:00:00.000Z' }));
    }));
    render(<ScheduledTeachingsPanel />);
    const input = await screen.findByTestId('scheduled-when-input');
    expect(screen.getByTestId('scheduled-save-time')).toBeDisabled(); // nothing changed yet
    fireEvent.change(input, { target: { value: '2099-12-01T11:00' } });
    fireEvent.click(screen.getByTestId('scheduled-save-time'));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatch(/^PATCH \{"postAt":"2099-12-01T/);
    fireEvent.click(screen.getByTestId('scheduled-live'));
    await waitFor(() => expect(calls).toContain('PATCH {"liveTeaching":true}'));
  });
});

// The quiz and the book source (central admin, one recording).
describe('A counted teaching: quiz and book source', () => {
  const admin = (children: React.ReactNode) => {
    who.member = { isCentralAdmin: true, canTeach: true };
    return children;
  };
  const serve = (current: () => unknown, calls: string[]) =>
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (url.includes('/central-cells/clinic')) return json({ book: { id: 'b1', titleEn: 'Kingdom Keys' } });
      if (url.includes('/draft-questions')) return json({ questions: [{ textEn: 'Who walked on water?', textFr: 'Qui a marché sur l’eau ?', options: [{ textEn: 'Peter', textFr: 'Pierre' }, { textEn: 'Judas', textFr: 'Judas' }], correctIndex: 0 }] });
      if (method === 'GET') return json({ items: [current()] });
      calls.push(`${method} ${url.split('/').slice(-1)[0]}${init?.body ? ` ${init.body}` : ''}`);
      if (method === 'DELETE') return json(item());
      return json(item({ quiz: { title: 'Faith', passMark: 70, openDays: 7, questions: [{ textEn: 'Who walked on water?', options: [{ textEn: 'Peter', isCorrect: true }, { textEn: 'Judas', isCorrect: false }] }], portion: { bookId: 'b1', page: 14, label: null } } }));
    }));

  it('is not offered to anyone but the central admin', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ items: [item()] })));
    render(<ScheduledTeachingsPanel />);
    await screen.findByTestId('scheduled-text-fr');
    expect(screen.queryByTestId('quiz-editor')).toBeNull();
  });

  it('says a quiz needs a single recording when an English and a French recording were made', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ items: [item({ mode: 'pair', clips: [{ language: 'en', audioUrl: 'https://x/e.mp3', textState: 'DONE' }, { language: 'fr', audioUrl: 'https://x/f.mp3', textState: 'DONE' }], textEn: 'Hi.', textFr: 'Salut.' })] })));
    render(admin(<ScheduledTeachingsPanel />));
    expect(await screen.findByTestId('quiz-pair-note')).toBeInTheDocument();
    expect(screen.queryByTestId('quiz-add')).toBeNull();
  });

  it('drafts questions from the text, takes a title, pass mark and book page, and saves the quiz', async () => {
    const calls: string[] = [];
    serve(() => item(), calls);
    render(admin(<ScheduledTeachingsPanel />));
    fireEvent.click(await screen.findByTestId('quiz-add'));
    expect(screen.getByTestId('quiz-save')).toBeDisabled(); // a title and a finished question are needed
    fireEvent.click(screen.getByTestId('quiz-draft'));
    await waitFor(() => expect((screen.getAllByTestId('quiz-question-text')[0] as HTMLInputElement).value).toBe('Who walked on water?'));
    expect(screen.getAllByTestId('quiz-question')).toHaveLength(1); // the draft replaced the blank question
    fireEvent.change(screen.getByTestId('quiz-title'), { target: { value: 'Faith' } });
    expect(await screen.findByTestId('quiz-tokens-note')).toHaveTextContent('earns no tokens');
    fireEvent.click(await screen.findByTestId('quiz-portion-on'));
    expect(screen.getByTestId('quiz-tokens-note')).toHaveTextContent('earn Dominion tokens');
    fireEvent.change(screen.getByTestId('quiz-portion-page'), { target: { value: '14' } });
    fireEvent.click(screen.getByTestId('quiz-save'));
    expect(await screen.findByTestId('quiz-summary')).toHaveTextContent('Faith');
    expect(screen.getByTestId('quiz-summary')).toHaveTextContent('from page 14');
    expect(calls).toHaveLength(1);
    const sent = JSON.parse(calls[0].replace(/^PUT quiz /, ''));
    expect(sent).toMatchObject({ title: 'Faith', passMark: 70, openDays: 7, portion: { bookId: 'b1', page: 14 } });
    expect(sent.questions[0].options.filter((o: any) => o.isCorrect)).toHaveLength(1);
  });

  it('needs exactly one correct answer, and removing the quiz asks first', async () => {
    const calls: string[] = [];
    const counted = item({ quiz: { title: 'Faith', passMark: 70, openDays: 7, questions: [{ textEn: 'Q?', options: [{ textEn: 'A', isCorrect: true }, { textEn: 'B', isCorrect: false }] }], portion: null } });
    serve(() => counted, calls);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(admin(<ScheduledTeachingsPanel />));
    expect(await screen.findByTestId('quiz-summary')).toHaveTextContent('1 question');
    fireEvent.click(screen.getByTestId('quiz-remove'));
    expect(confirm).toHaveBeenCalled();
    expect(calls).toEqual([]);
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByTestId('quiz-remove'));
    await waitFor(() => expect(calls).toEqual(['DELETE quiz']));
    confirm.mockRestore();
  });
});
