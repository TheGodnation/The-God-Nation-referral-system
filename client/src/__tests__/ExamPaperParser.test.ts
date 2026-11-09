import { describe, expect, it } from 'vitest';
import { parseExamSets } from '../lib/examPaperParser';

const PAPER = `THE RESTORATION OF DOMINION
Kingdom Series Book One: Exam Set 2 of 3
Name: ______________________________ Date: ________________
Sections A and B: 25 marks Pass mark: 18 (72%) Your score: ______ / 25
Section A: Choose the Best Answer (2 marks)
1. What does the Preface say?
A. First wrong
B. First right (with brackets)
C. Third
D. Fourth
2. Which is NOT true?
A. One
B. Two
C. Three
D. Four
Section B: True or False (2 marks)
Write TRUE or FALSE after each statement, according to the book.
3. The book teaches something true. ________
4. The book teaches something false. ________
Section C: My Personal Response (not marked)
Answer honestly, before God.
C1. Do you know that you are born again?
( ) Yes, I know I am born again
( ) I think so, but I am not sure
( ) Yes, but I still have doubts
( ) No
If yes, when did this happen? (a year):
C2. What holds you back? If nothing, write "nothing".
My answer:
C3. Which of them do you relate to most?
My answer:
C4. My Confession of Faith
Read this confession slowly.
I confess Jesus Christ as my Lord.
( ) I agree with this confession, and I make it my own
( ) I do not agree with this confession
Signed: ______________________________ Date: ________________
Well done for pressing in.
THE RESTORATION OF DOMINION
Teacher's Answer Key: Exam Set 2 of 3
Confidential: do not share with students
Section A: Multiple Choice (1 mark each)
1. B. First right (with brackets) (Preface)
2. D. Four (Chapter 3)
Section B: True or False (1 mark each)
3. TRUE. Because it is. (Chapter 1)
4. FALSE. Because it is not. (Chapter 2)
Section C: Personal Response Guide (not marked)
This section is not graded.
C1. Yes: ask what changed. Not sure: pray with them.
C2. Read with care.
C3. This shows the real fear.
C4 (Confession). Agree: rejoice. Do not agree: respect their honesty.`;

describe('parseExamSets', () => {
  const [set] = parseExamSets(PAPER);

  it('reads the set number, the marked questions and the right answers from the key', () => {
    expect(set).toMatchObject({ setNumber: 2, of: 3, warnings: [] });
    expect(set.questions.map((q) => [q.number, q.kind, q.correct, q.options.length])).toEqual([
      [1, 'CHOICE', 1, 4],
      [2, 'CHOICE', 3, 4],
      [3, 'TRUE_FALSE', 0, 2],
      [4, 'TRUE_FALSE', 1, 2],
    ]);
    expect(set.questions[0].options[1]).toBe('First right (with brackets)');
    expect(set.questions[2]).toMatchObject({ text: 'The book teaches something true.', options: ['TRUE', 'FALSE'] });
  });

  it('reads the personal questions: choices with their signals, typed answers, the follow-up and the confession', () => {
    expect(set.personal.map((p) => [p.code, p.kind, p.required, p.flagUnlessNone])).toEqual([
      ['C1', 'CHOICE', true, false],
      ['C1a', 'TEXT', false, false],
      ['C2', 'TEXT', true, true],
      ['C3', 'TEXT', true, false],
      ['C4', 'CHOICE', true, false],
    ]);
    // A clear "yes" is positive; "Yes, but ... doubts" and "I think so, but I am not sure" are not.
    expect(set.personal[0].options.map((o) => o.signal)).toEqual(['POSITIVE', 'NEEDS_TALK', 'NEEDS_TALK', 'NEEDS_TALK']);
    expect(set.personal[1].text).toBe('If yes, when did this happen? (a year)');
    const confession = set.personal[4];
    expect(confession.text).toBe('My Confession of Faith');
    expect(confession.body).toBe('Read this confession slowly.\n\nI confess Jesus Christ as my Lord.');
    expect(confession.options.map((o) => o.signal)).toEqual(['POSITIVE', 'NEEDS_TALK']);
  });

  it('puts the teacher guide beside each question (the follow-up has none of its own)', () => {
    expect(set.personal.map((p) => p.guide)).toEqual([
      'Yes: ask what changed. Not sure: pray with them.',
      null,
      'Read with care.',
      'This shows the real fear.',
      'Agree: rejoice. Do not agree: respect their honesty.',
    ]);
  });

  it('lets the caller say which questions do not decide the status, and which options are the clear yes', () => {
    const [s] = parseExamSets(PAPER, { notStatus: { 2: ['C3'] }, positive: { 2: { C1: [0, 1] } } });
    expect(s.personal.find((p) => p.code === 'C3')!.affectsStatus).toBe(false);
    expect(s.personal.find((p) => p.code === 'C1')!.affectsStatus).toBe(true);
    expect(s.personal[0].options.map((o) => o.signal)).toEqual(['POSITIVE', 'POSITIVE', 'NEEDS_TALK', 'NEEDS_TALK']);
  });

  it('warns when the key does not match the question, has no answer for it, or a question lacks four choices', () => {
    const broken = PAPER.replace('1. B. First right (with brackets) (Preface)', '1. B. Something else entirely (Preface)').replace('2. D. Four (Chapter 3)\n', '').replace('D. Four\nSection B', 'Section B');
    const [w] = parseExamSets(broken);
    expect(w.warnings).toEqual(expect.arrayContaining(['KEY_DIFFERS:1', 'NO_ANSWER:2', 'OPTIONS:2']));
  });

  it('warns when there is no key at all', () => {
    const [w] = parseExamSets(PAPER.split("THE RESTORATION OF DOMINION\nTeacher's Answer Key")[0]);
    expect(w.warnings).toContain('NO_KEY');
    expect(w.questions.every((q) => q.correct === -1)).toBe(true);
  });

  it('reads several sets in order, and French papers (VRAI / FAUX, Oui / Je suis d\'accord, "écrivez « rien »")', () => {
    const FR = `LA RESTAURATION DE LA DOMINATION
Livre Un de la Série du Royaume : Jeu d'examen 1 sur 2
Section A : Choisissez la meilleure réponse (1 point)
1. Que dit la Préface ?
A. Un
B. Deux
C. Trois
D. Quatre
Section B : Vrai ou faux (1 point)
2. Le livre enseigne une chose. ________
Section C : Ma réponse personnelle (non notée)
C1. Êtes-vous né de nouveau ?
( ) Oui, je le sais
( ) Oui, mais j'ai des doutes
( ) Pas encore
C2. Qu'est-ce qui vous retient ? Si rien, écrivez « rien ».
Ma réponse :
C3. Ma confession de foi
Lisez lentement.
Je confesse Jésus-Christ.
( ) Je suis d'accord avec cette confession
( ) Je ne suis pas d'accord avec cette confession
Signé : ______________________________
LA RESTAURATION DE LA DOMINATION
Corrigé de l'enseignant : Jeu d'examen 1 sur 2
Section A : Choix multiple
1. C. Trois (Préface)
Section B : Vrai ou faux
2. FAUX. Parce que. (Chapitre 1)
Section C : Guide de la réponse personnelle (non noté)
C1. Oui : affirmez-la.
C2. Lisez avec soin.
C3 (Confession). D'accord : réjouissez-vous.
${PAPER.replace(/Exam Set 2 of 3/g, 'Exam Set 2 of 2')}`;
    const sets = parseExamSets(FR, { language: 'FR' });
    expect(sets.map((s) => s.setNumber)).toEqual([1, 2]);
    const [fr] = sets;
    expect(fr.questions.map((q) => [q.kind, q.correct, q.options.join('/')])).toEqual([
      ['CHOICE', 2, 'Un/Deux/Trois/Quatre'],
      ['TRUE_FALSE', 1, 'VRAI/FAUX'],
    ]);
    expect(fr.personal.map((p) => [p.code, p.flagUnlessNone])).toEqual([['C1', false], ['C2', true], ['C3', false]]);
    expect(fr.personal[0].options.map((o) => o.signal)).toEqual(['POSITIVE', 'NEEDS_TALK', 'NEEDS_TALK']);
    expect(fr.personal[2].options.map((o) => o.signal)).toEqual(['POSITIVE', 'NEEDS_TALK']);
    expect(fr.personal[1].guide).toBe('Lisez avec soin.');
  });
});
