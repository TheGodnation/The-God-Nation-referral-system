import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MemberAssessmentPage } from '../pages/MemberAssessmentPage';
import { FaithJourneysPanel } from '../components/faith/FaithJourneysPanel';
import { PersonFaithCard } from '../components/faith/PersonFaithCard';
import { PersonalQuestionsView, type PersonalDetail } from '../components/admin/AssessmentsTab';
import { PasteExamPanel } from '../components/admin/PasteExamPanel';

// Faith journey: the personal section of the Book 1 / Book 2 exams (required,
// never marked), and the central admin's list of what people answered.
const calls: { url: string; method: string; body: any }[] = [];

function mockFetch(routes: Record<string, (body: any) => { status?: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ url, method, body });
      const key = Object.keys(routes)
        .sort((a, b) => b.length - a.length)
        .find((k) => {
          const [m, path] = k.split(' ');
          return m === method && url.startsWith(path);
        });
      const res = key ? routes[key](body) : { status: 404, body: { error: 'not found' } };
      const status = res.status ?? 200;
      return Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => res.body });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

// ------------------------------ The exam page ------------------------------

const TRAINING = { inProgressAttemptId: null, submittedTries: 0, passed: false, retakeGranted: false, canStart: true, block: null };
const EXAM = { id: 'e1', titleEn: 'Book 1 exam', titleFr: null, passMark: 70, maxAttempts: null, open: true, firstTryCounts: false, training: TRAINING };
const QUESTIONS = {
  status: 'IN_PROGRESS',
  questions: [{ id: 'q1', textEn: 'A marked question', textFr: 'Une question notée', points: 1, options: [{ id: 'o1', textEn: 'Right', textFr: null }, { id: 'o2', textEn: 'Wrong', textFr: null }] }],
  personalQuestions: [
    { id: 'p1', kind: 'CHOICE', textEn: 'Do you know you are born again?', textFr: 'Savez-vous que vous êtes né de nouveau ?', bodyEn: null, bodyFr: null, required: true, options: [{ id: 'po1', textEn: 'Yes, I know', textFr: 'Oui, je sais' }, { id: 'po2', textEn: 'Not sure', textFr: 'Pas sûr' }] },
    { id: 'p2', kind: 'TEXT', textEn: 'What holds you back? (write "nothing")', textFr: null, bodyEn: null, bodyFr: null, required: true, options: [] },
    { id: 'p3', kind: 'CHOICE', textEn: 'My Confession of Faith', textFr: 'Ma confession de foi', bodyEn: 'I confess Jesus Christ as my Lord.', bodyFr: null, required: true, options: [{ id: 'po3', textEn: 'I agree with this confession', textFr: null }, { id: 'po4', textEn: 'I do not agree', textFr: null }] },
  ],
};

function renderExam() {
  return render(
    <MemoryRouter initialEntries={['/member/assessments/e1']}>
      <Routes>
        <Route path="/member/assessments/:id" element={<MemberAssessmentPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function startExam(questions: unknown = QUESTIONS, submitStatus = 200) {
  mockFetch({
    'GET /api/member/assessments/e1/my-attempts': () => ({ body: { items: [] } }),
    'GET /api/member/assessments/e1': () => ({ body: EXAM }),
    'POST /api/member/assessments/e1/attempts': () => ({ status: 201, body: { id: 'a1' } }),
    'GET /api/member/attempts/a1/questions': () => ({ body: questions }),
    'POST /api/member/attempts/a1/submit': () => ({ status: submitStatus, body: submitStatus === 200 ? { id: 'a1', attemptNumber: 1, status: 'SUBMITTED', score: 1, maxScore: 1, percentage: 100, passed: true } : { error: 'Please answer every personal question before you finish.', code: 'PERSONAL_REQUIRED' } }),
  });
  renderExam();
  fireEvent.click(await screen.findByRole('button', { name: 'Start' }));
  fireEvent.click(await screen.findByRole('button', { name: 'I understand, start the exam' }));
  await screen.findByText('A marked question');
}

describe('The exam page: the personal section', () => {
  it('shows the personal questions after the marked ones, with the confession in its own box', async () => {
    await startExam();
    const section = screen.getByTestId('personal-section');
    expect(within(section).getByText('My personal response')).toBeInTheDocument();
    expect(within(section).getByText(/not marked and does not change your result/)).toBeInTheDocument();
    expect(within(section).getByText('1. Do you know you are born again?')).toBeInTheDocument();
    expect(within(section).getByText('I confess Jesus Christ as my Lord.')).toBeInTheDocument();
    // The marked question comes first, then Section C.
    expect(screen.getByText('A marked question').compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('will not finish until every personal question is answered, and points at the ones missing', async () => {
    await startExam();
    fireEvent.click(screen.getByLabelText('Right'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Answers' }));
    expect(await screen.findByText('Please answer every personal question before you finish.')).toBeInTheDocument();
    expect(screen.getAllByText('Please answer this question.')).toHaveLength(3);
    expect(calls.some((c) => c.url.endsWith('/submit'))).toBe(false);

    // Blank words are not an answer either.
    fireEvent.click(screen.getByLabelText('Yes, I know'));
    fireEvent.change(screen.getByLabelText('What holds you back? (write "nothing")'), { target: { value: '   ' } });
    fireEvent.click(screen.getByLabelText('I agree with this confession'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Answers' }));
    expect(await screen.findAllByText('Please answer this question.')).toHaveLength(1);
    expect(calls.some((c) => c.url.endsWith('/submit'))).toBe(false);
  });

  it('sends the marked answers and the personal answers together once everything is answered', async () => {
    await startExam();
    fireEvent.click(screen.getByLabelText('Right'));
    fireEvent.click(screen.getByLabelText('Yes, I know'));
    fireEvent.change(screen.getByLabelText('What holds you back? (write "nothing")'), { target: { value: 'nothing' } });
    fireEvent.click(screen.getByLabelText('I agree with this confession'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Answers' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/submit'))).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/submit'))!.body).toEqual({
      answers: [{ questionId: 'q1', selectedOptionId: 'o1' }],
      personal: [
        { questionId: 'p1', optionId: 'po1' },
        { questionId: 'p2', text: 'nothing' },
        { questionId: 'p3', optionId: 'po3' },
      ],
    });
    // The result shows only the mark: nothing about the personal answers.
    expect(await screen.findByText(/Passed/i)).toBeInTheDocument();
    expect(screen.queryByTestId('personal-section')).not.toBeInTheDocument();
  });

  it('keeps the personal answers on the phone while the exam is open', async () => {
    await startExam();
    fireEvent.click(screen.getByLabelText('Not sure'));
    expect(JSON.parse(localStorage.getItem('exam-personal:a1') || '{}')).toEqual({ p1: { optionId: 'po2' } });
  });

  it('an exam without personal questions looks and sends exactly as before', async () => {
    await startExam({ ...QUESTIONS, personalQuestions: [] });
    expect(screen.queryByTestId('personal-section')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Right'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Answers' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/submit'))).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/submit'))!.body).toEqual({ answers: [{ questionId: 'q1', selectedOptionId: 'o1' }] });
  });
});

// ------------------------- The faith journeys list --------------------------

const ROWS = {
  NEEDS: [{ personId: 'p1', name: 'Marie Ngo', status: 'NEEDS_CONVERSATION', lastAnsweredAt: '2026-11-09T10:00:00Z', confirmedAt: null, confirmedByName: null }],
  ALL: [
    { personId: 'p1', name: 'Marie Ngo', status: 'NEEDS_CONVERSATION', lastAnsweredAt: '2026-11-09T10:00:00Z', confirmedAt: null, confirmedByName: null },
    { personId: 'p2', name: 'Paul Fotso', status: 'BORN_AGAIN', lastAnsweredAt: '2026-11-08T10:00:00Z', confirmedAt: '2026-11-09T12:00:00Z', confirmedByName: 'Evangelist Stanley' },
  ],
};

const JOURNEY = {
  person: { id: 'p1', name: 'Marie Ngo', whatsappNumber: '+237670000001' },
  status: 'NEEDS_CONVERSATION',
  lastAnsweredAt: '2026-11-09T10:00:00Z',
  confirmedAt: null,
  confirmedByName: null,
  notes: [],
  tries: [
    {
      attemptId: 'a1',
      answeredAt: '2026-11-09T10:00:00Z',
      book: { number: 1, titleEn: 'The Restoration of Dominion', titleFr: null },
      setNumber: 2,
      attemptNumber: 1,
      score: 24,
      maxScore: 25,
      passed: true,
      answers: [
        { order: 0, signal: 'NEEDS_TALK', questionEn: 'Do you know you are born again?', questionFr: null, answerEn: 'I think so, but I am not sure', answerFr: null, guideEn: 'Unsure: explain John 3:3-5.', guideFr: null },
        { order: 1, signal: 'POSITIVE', questionEn: 'My Confession of Faith', questionFr: null, answerEn: 'I agree with this confession', answerFr: null, guideEn: null, guideFr: null },
      ],
    },
  ],
};

describe('Faith journeys (central admin)', () => {
  function adminRoutes(extra: Record<string, (body: any) => { status?: number; body: unknown }> = {}) {
    let journey: any = JOURNEY;
    mockFetch({
      'GET /api/member/faith/access': () => ({ body: { role: 'ADMIN', leadersSee: false, canRead: true } }),
      'GET /api/member/faith/p1': () => ({ body: journey }),
      'POST /api/member/faith/p1/confirm': (b) => {
        journey = { ...journey, confirmedAt: b.confirmed ? '2026-11-09T13:00:00Z' : null, confirmedByName: b.confirmed ? 'Evangelist Stanley' : null };
        return { body: journey };
      },
      'POST /api/member/faith/p1/notes': (b) => {
        journey = { ...journey, notes: [{ id: 'n1', authorName: 'Evangelist Stanley', text: b.text, createdAt: '2026-11-09T13:00:00Z' }, ...journey.notes] };
        return { status: 201, body: journey };
      },
      'PUT /api/member/faith/settings': (b) => ({ body: { leadersSeeFaithJourney: b.leadersSeeFaithJourney } }),
      'GET /api/member/faith': () => ({ body: { items: ROWS.NEEDS } }),
      ...extra,
    });
  }

  it('lists the people who need a conversation first, and the other lists on a tap', async () => {
    adminRoutes({ 'GET /api/member/faith?filter=ALL': () => ({ body: { items: ROWS.ALL } }) });
    render(<FaithJourneysPanel base="/api/member/faith" />);
    const row = await screen.findByTestId('faith-row');
    expect(within(row).getByText('Marie Ngo')).toBeInTheDocument();
    expect(within(row).getByTestId('faith-status')).toHaveTextContent('Needs a conversation');
    expect(screen.getByRole('tab', { name: 'Needs a conversation', selected: true })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Everyone' }));
    expect(await screen.findByText('Paul Fotso')).toBeInTheDocument();
    const paul = screen.getAllByTestId('faith-row')[1];
    expect(within(paul).getByText('Confirmed')).toBeInTheDocument();
  });

  it('opens a person: every answer with the teacher guide, flagged answers marked, then confirms and writes a note', async () => {
    adminRoutes();
    render(<FaithJourneysPanel base="/api/member/faith" />);
    fireEvent.click(await screen.findByTestId('faith-row'));
    const journey = await screen.findByTestId('faith-journey');
    expect(within(journey).getByText('Marie Ngo')).toBeInTheDocument();
    expect(within(journey).getByText('+237670000001')).toBeInTheDocument();
    expect(within(journey).getByText(/Book 1 exam/)).toBeInTheDocument();
    expect(within(journey).getByText(/Try 1 · question set 2 · 24\/25/)).toBeInTheDocument();
    expect(within(journey).getByText('⚑ I think so, but I am not sure')).toBeInTheDocument();
    expect(within(journey).getByText('Unsure: explain John 3:3-5.')).toBeInTheDocument();
    expect(within(journey).getByText('I agree with this confession')).toBeInTheDocument();

    fireEvent.click(within(journey).getByRole('button', { name: 'I have spoken with this person: confirm' }));
    expect(await within(journey).findByText(/Confirmed by Evangelist Stanley on/)).toBeInTheDocument();
    expect(calls.find((c) => c.url.endsWith('/p1/confirm'))!.body).toEqual({ confirmed: true });
    expect(within(journey).getByRole('button', { name: 'Take the confirmation off' })).toBeInTheDocument();

    const saveNote = within(journey).getByRole('button', { name: 'Save the note' });
    expect(saveNote).toBeDisabled();
    fireEvent.change(within(journey).getByLabelText('What did you speak about? What is the next step?'), { target: { value: 'Prayed together on the phone.' } });
    fireEvent.click(saveNote);
    expect(await within(journey).findByText('Prayed together on the phone.')).toBeInTheDocument();
    expect(calls.find((c) => c.url.endsWith('/p1/notes'))!.body).toEqual({ text: 'Prayed together on the phone.' });

    fireEvent.click(within(journey).getByRole('button', { name: /Back to the list/ }));
    expect(await screen.findByTestId('faith-panel')).toBeInTheDocument();
  });

  it('only the central admin sees the switch for leaders, and it saves at once', async () => {
    adminRoutes();
    render(<FaithJourneysPanel base="/api/member/faith" />);
    const box = await screen.findByRole('checkbox', { name: /Let leaders see the faith journey of their own people/ });
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ leadersSeeFaithJourney: true }));
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeChecked());
  });

  it('a leader sees the list without the switch', async () => {
    mockFetch({
      'GET /api/member/faith/access': () => ({ body: { role: 'LEADER', leadersSee: true, canRead: true } }),
      'GET /api/member/faith': () => ({ body: { items: ROWS.NEEDS } }),
    });
    render(<FaithJourneysPanel base="/api/member/faith" />);
    expect(await screen.findByTestId('faith-row')).toBeInTheDocument();
    expect(screen.getByText(/the people of your assembly/)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('marks answers that call for a conversation even for someone born again, with a "To follow up" list', async () => {
    mockFetch({
      'GET /api/member/faith/access': () => ({ body: { role: 'ADMIN', leadersSee: false, canRead: true } }),
      'GET /api/member/faith?filter=FOLLOW_UP': () => ({ body: { items: [{ personId: 'p3', name: 'Not yet baptized', status: 'BORN_AGAIN', lastAnsweredAt: '2026-11-09T10:00:00Z', confirmedAt: null, confirmedByName: null, flagged: 2 }] } }),
      'GET /api/member/faith': () => ({ body: { items: [] } }),
    });
    render(<FaithJourneysPanel base="/api/member/faith" />);
    fireEvent.click(await screen.findByRole('tab', { name: 'To follow up' }));
    const row = await screen.findByTestId('faith-row');
    expect(within(row).getByText('Not yet baptized')).toBeInTheDocument();
    expect(within(row).getByTestId('faith-status')).toHaveTextContent('Born again');
    expect(within(row).getByTestId('faith-flagged')).toHaveTextContent('⚑ 2 to follow up');
  });

  it('says so when nobody needs a conversation', async () => {
    mockFetch({
      'GET /api/member/faith/access': () => ({ body: { role: 'ADMIN', leadersSee: false, canRead: true } }),
      'GET /api/member/faith': () => ({ body: { items: [] } }),
    });
    render(<FaithJourneysPanel base="/api/member/faith" />);
    expect(await screen.findByText('Nobody needs a conversation right now.')).toBeInTheDocument();
  });
});

describe('The faith card on a person\'s profile', () => {
  function renderCard() {
    return render(
      <MemoryRouter>
        <PersonFaithCard personId="p1" />
      </MemoryRouter>,
    );
  }

  it('links to the journey with the status, for someone who may read it', async () => {
    mockFetch({ 'GET /api/member/faith/p1/exists': () => ({ body: { exists: true, status: 'NEEDS_CONVERSATION', confirmed: false } }) });
    renderCard();
    const card = await screen.findByTestId('person-faith-card');
    expect(card).toHaveAttribute('href', '/member/faith/p1');
    expect(within(card).getByTestId('faith-status')).toHaveTextContent('Needs a conversation');
  });

  it('shows nothing when there is no journey, or the viewer may not read it', async () => {
    mockFetch({ 'GET /api/member/faith/p1/exists': () => ({ body: { exists: false } }) });
    renderCard();
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(screen.queryByTestId('person-faith-card')).not.toBeInTheDocument();
  });
});

describe('The exam editor: the personal questions of a set (read-only)', () => {
  const questions: PersonalDetail[] = [
    { id: 'p1', setNumber: 1, order: 0, kind: 'CHOICE', textEn: 'Do you know you are born again?', textFr: 'Savez-vous que vous êtes né de nouveau ?', bodyEn: null, guideEn: 'Unsure: explain John 3:3-5.', required: true, flagUnlessNone: false, affectsStatus: true, options: [{ id: 'o1', textEn: 'Yes, I know', textFr: null, signal: 'POSITIVE' }, { id: 'o2', textEn: 'Not sure', textFr: null, signal: 'NEEDS_TALK' }] },
    { id: 'p2', setNumber: 1, order: 1, kind: 'TEXT', textEn: 'What holds you back?', textFr: null, bodyEn: null, guideEn: null, required: true, flagUnlessNone: true, affectsStatus: true, options: [] },
    { id: 'p3', setNumber: 1, order: 2, kind: 'CHOICE', textEn: 'Reading the Word?', textFr: null, bodyEn: null, guideEn: null, required: false, flagUnlessNone: false, affectsStatus: false, options: [{ id: 'o3', textEn: 'Every day', textFr: null, signal: 'POSITIVE' }] },
  ];

  it('lists each question with what every choice counts as, and the teacher guide', () => {
    render(<PersonalQuestionsView questions={questions} />);
    const view = screen.getByTestId('personal-questions-view');
    expect(within(view).getByText('Personal questions (not marked): 3')).toBeInTheDocument();
    expect(within(view).getByText('✓ Yes, I know')).toBeInTheDocument();
    expect(within(view).getByText('⚑ Not sure')).toBeInTheDocument();
    expect(within(view).getByText('Unsure: explain John 3:3-5.')).toBeInTheDocument();
    expect(within(view).getByText('Savez-vous que vous êtes né de nouveau ?')).toBeInTheDocument();
    expect(within(view).getByText(/anything other than "nothing" calls for a conversation/)).toBeInTheDocument();
    expect(within(view).getByText('(does not change the status)')).toBeInTheDocument();
    expect(within(view).getByText('(optional)')).toBeInTheDocument();
  });

  it('shows nothing for a set without personal questions', () => {
    const { container } = render(<PersonalQuestionsView questions={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('Paste an exam (central admin)', () => {
  const PAPER = `THE RESTORATION OF DOMINION
Kingdom Series Book One: Exam Set 1 of 1
Section A: Choose the Best Answer (1 mark)
1. What does the Preface say?
A. Wrong one
B. The right one
C. Wrong two
D. Wrong three
Section B: True or False (1 mark)
2. The book teaches something true. ________
Section C: My Personal Response (not marked)
C1. Do you know that you are born again?
( ) Yes, I know I am born again
( ) Not sure
C2. How do you read the Word?
( ) Every day
( ) Not yet
C3. My Confession of Faith
Read slowly.
I confess Jesus Christ as my Lord.
( ) I agree with this confession
( ) I do not agree with this confession
Signed: ______
THE RESTORATION OF DOMINION
Teacher's Answer Key: Exam Set 1 of 1
Section A: Multiple Choice (1 mark each)
1. B. The right one (Preface)
Section B: True or False (1 mark each)
2. TRUE. Because it is. (Chapter 1)
Section C: Personal Response Guide (not marked)
C1. Not sure: pray with them.
C2. Help them start a plan.
C3 (Confession). Agree: rejoice.`;

  function open() {
    render(<PasteExamPanel bookId="b1" onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Paste an exam/ }));
    fireEvent.change(screen.getByLabelText('The exam'), { target: { value: PAPER } });
    fireEvent.click(screen.getByRole('button', { name: 'Read it and show me' }));
  }

  it('shows every set as it was read, with right answers, signals and guide, and saves only when told to', async () => {
    mockFetch({ 'POST /api/admin/library/books/b1/exam-import': () => ({ body: { ok: true, saved: [1], skipped: [] } }) });
    open();
    const preview = await screen.findByTestId('exam-set-preview');
    expect(within(preview).getByText('Set 1: 2 marked questions (1 choice, 1 true or false) and 3 personal questions')).toBeInTheDocument();
    expect(within(preview).getByText('✓ The right one')).toBeInTheDocument();
    expect(within(preview).getByText('✓ Yes, I know I am born again')).toBeInTheDocument();
    expect(within(preview).getByText('⚑ Not sure')).toBeInTheDocument();
    expect(within(preview).getByText('Not sure: pray with them.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    // The Bible-reading question does not decide the status.
    fireEvent.click(within(preview).getAllByLabelText('This question does not decide whether the person is born again')[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Save these sets' }));
    expect(await screen.findByTestId('exam-saved')).toHaveTextContent('Saved: set 1.');
    const sent = calls.find((c) => c.method === 'POST')!.body;
    expect(sent.language).toBe('EN');
    expect(sent.sets).toHaveLength(1);
    expect(sent.sets[0].questions[0]).toEqual({ text: 'What does the Preface say?', options: [{ text: 'Wrong one', isCorrect: false }, { text: 'The right one', isCorrect: true }, { text: 'Wrong two', isCorrect: false }, { text: 'Wrong three', isCorrect: false }] });
    expect(sent.sets[0].questions[1].options).toEqual([{ text: 'TRUE', isCorrect: true }, { text: 'FALSE', isCorrect: false }]);
    expect(sent.sets[0].personal.map((p: any) => [p.text, p.affectsStatus])).toEqual([['Do you know that you are born again?', true], ['How do you read the Word?', false], ['My Confession of Faith', true]]);
    expect(sent.sets[0].personal[0].guide).toBe('Not sure: pray with them.');
    expect(sent.sets[0].personal[2].body).toBe('Read slowly.\n\nI confess Jesus Christ as my Lord.');
  });

  it('with several sets, the personal questions of the first set are used for every set (unless unticked)', async () => {
    const SET2 = PAPER.replace(/Exam Set 1 of 1/g, 'Exam Set 2 of 2').replace(/The right one/g, 'The other right one').replace(/Not yet/g, 'Not at all').replace(/Not sure/g, 'Maybe');
    const TWO = PAPER.replace(/Exam Set 1 of 1/g, 'Exam Set 1 of 2') + '\n' + SET2;
    mockFetch({ 'POST /api/admin/library/books/b1/exam-import': () => ({ body: { ok: true, saved: [1, 2], skipped: [] } }) });
    render(<PasteExamPanel bookId="b1" onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Paste an exam/ }));
    fireEvent.change(screen.getByLabelText('The exam'), { target: { value: TWO } });
    fireEvent.click(screen.getByRole('button', { name: 'Read it and show me' }));
    const box = await screen.findByRole('checkbox', { name: /Use the same personal questions in every set/ });
    expect(box).toBeChecked();
    expect(screen.getByText('Personal questions: the same as Set 1.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save these sets' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const sent = calls.find((c) => c.method === 'POST')!.body;
    expect(sent.sets.map((x: any) => x.questions[0].options[1].text)).toEqual(['The right one', 'The other right one']);
    expect(sent.sets[1].personal).toEqual(sent.sets[0].personal);
    expect(sent.sets[1].personal[0].options[1].text).toBe('Not sure');

    // Unticked: each set keeps its own.
    calls.length = 0;
    fireEvent.change(screen.getByLabelText('The exam'), { target: { value: TWO } });
    fireEvent.click(screen.getByRole('button', { name: 'Read it and show me' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /Use the same personal questions in every set/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save these sets' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const own = calls.find((c) => c.method === 'POST')!.body;
    expect(own.sets[1].personal[0].options[1].text).toBe('Maybe');
  });

  it('will not save a set whose key does not match, and says which question', async () => {
    mockFetch({});
    render(<PasteExamPanel bookId="b1" onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Paste an exam/ }));
    fireEvent.change(screen.getByLabelText('The exam'), { target: { value: PAPER.replace('1. B. The right one (Preface)', '1. B. Something else (Preface)') } });
    fireEvent.click(screen.getByRole('button', { name: 'Read it and show me' }));
    expect(await screen.findByText('Question 1: the answer key does not match any of its choices.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save these sets' })).toBeDisabled();
    expect(screen.getByText('Fix the lines marked in red before saving.')).toBeInTheDocument();
  });

  it('says so when no exam is found in the text, and tells which sets were left alone', async () => {
    mockFetch({ 'POST /api/admin/library/books/b1/exam-import': () => ({ body: { ok: true, saved: [2], skipped: [1] } }) });
    render(<PasteExamPanel bookId="b1" onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Paste an exam/ }));
    fireEvent.change(screen.getByLabelText('The exam'), { target: { value: 'Just some words.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Read it and show me' }));
    expect(screen.getByText(/No questions were found/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('The exam'), { target: { value: PAPER } });
    fireEvent.click(screen.getByRole('button', { name: 'Read it and show me' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save these sets' }));
    expect(await screen.findByText(/Not changed \(someone already took them\): set 1\./)).toBeInTheDocument();
  });
});
