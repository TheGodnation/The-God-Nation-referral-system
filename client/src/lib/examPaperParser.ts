// Reads an exam as the founder writes it (a question paper, and its teacher's
// answer key) into what the app stores for one question set of a leadership
// book's exam:
//   - Section A: multiple choice, "1. question" then "A. ... B. ... C. ... D. ...";
//   - Section B: true / false, "21. statement ________";
//   - Section C: personal questions, never marked ("C1. question", then
//     "( ) choice" lines, or a "My answer:" line for words to be typed);
//   - the key: "1. D. the right answer (Chapter 1)", "21. TRUE. why (Chapter 1)",
//     and, for Section C, "C1. what to say to the person" (the teacher's guide).
// The text may hold several sets at once: each paper starts at a line like
// "... Exam Set 1 of 3" and each key at "Teacher's Answer Key: Exam Set 1 of 3".
// English and French both read the same way (A/B/C/D, TRUE/VRAI, FALSE/FAUX).

export interface ParsedQuestion {
  number: number;
  text: string;
  /** The answer choices in the written order (true/false questions get TRUE and FALSE). */
  options: string[];
  /** Index of the right option, from the key (-1 when the key does not cover it). */
  correct: number;
  kind: 'CHOICE' | 'TRUE_FALSE';
}

export interface ParsedPersonalQuestion {
  code: string; // "C1"
  kind: 'CHOICE' | 'TEXT';
  text: string;
  body: string | null;
  options: { text: string; signal: 'POSITIVE' | 'NEEDS_TALK' }[];
  guide: string | null;
  required: boolean;
  flagUnlessNone: boolean;
  affectsStatus: boolean;
}

export interface ParsedExamSet {
  setNumber: number;
  of: number | null;
  questions: ParsedQuestion[];
  personal: ParsedPersonalQuestion[];
  warnings: string[];
}

const HEADER = /(?:Exam\s+Set|Jeu\s+d['’]examen|S[ée]rie\s+d['’]examen)\s+(\d+)\s+(?:of|sur)\s+(\d+)/i;
const KEY_WORDS = /answer\s+key|corrig[ée]|cl[ée]\s+de\s+correction/i;
const SECTION = /^Section\s+([ABC])\b/i;
const QUESTION = /^(\d{1,3})\.\s+(.+)$/;
const OPTION = /^([A-D])\.\s+(.+)$/;
const PERSONAL = /^C(\d{1,2})\.\s+(.*)$/;
const RADIO = /^\(\s*\)\s*(.+)$/;
const MY_ANSWER = /^(?:My|Ma|Mon|Mes)\s/i;
const KEY_CHOICE = /^(\d{1,3})\.\s+([A-D])\.\s+(.+)$/;
const KEY_TF = /^(\d{1,3})\.\s+(TRUE|FALSE|VRAI|FAUX)\.\s*(.*)$/i;
const KEY_PERSONAL = /^C(\d{1,2})(?:\s*\([^)]*\))?\.\s+(.+)$/;
// "write \"nothing\"" (the word, then the closing quote): "nothing yet" is a different kind of answer and is not matched.
const WRITE_NOTHING = /(?:write|[ée]crivez)\s+[«"“'‘]\s*(?:nothing|none|rien|aucun|aucune)\s*[.»"”'’]/i;
const POSITIVE_START = /^(?:yes\b|i\s+agree\b|oui\b|je\s+suis\s+d['’]accord\b)/i;
const HEDGE = /\bbut\b|not\s+sure|\bdoubt|\bmais\b|pas\s+s[ûu]r|\bdoute/i;

function clean(line: string): string {
  return line
    .replace(/[   ]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** The "(Chapter 1)" at the end of a key line, taken off. */
function withoutSource(text: string): string {
  return text.replace(/\s+\([A-Za-zÀ-ÿ'’-]+(?:\s+[A-Za-zÀ-ÿ'’-]+){0,3}(?:\s+\d+)?\)\.?\s*$/u, '').trim();
}

function isPositive(option: string): boolean {
  return POSITIVE_START.test(option) && !HEDGE.test(option);
}

interface Segment {
  setNumber: number;
  of: number | null;
  isKey: boolean;
  lines: string[];
}

function segmentsOf(raw: string): Segment[] {
  const lines = raw
    .replace(/\r/g, '')
    .split('\n')
    .map(clean)
    .filter(Boolean);
  const segments: Segment[] = [];
  let current: Segment | null = null;
  for (const line of lines) {
    const m = line.match(HEADER);
    if (m && line.length < 140) {
      current = { setNumber: Number(m[1]), of: Number(m[2]), isKey: KEY_WORDS.test(line), lines: [] };
      segments.push(current);
    } else if (current) current.lines.push(line);
  }
  return segments;
}

interface PaperParsed {
  questions: Omit<ParsedQuestion, 'correct'>[];
  personal: Omit<ParsedPersonalQuestion, 'guide'>[];
}

function parsePaper(lines: string[], tfWords: [string, string]): PaperParsed {
  const questions: Omit<ParsedQuestion, 'correct'>[] = [];
  const personal: Omit<ParsedPersonalQuestion, 'guide'>[] = [];
  let section: 'PRE' | 'A' | 'B' | 'C' = 'PRE';
  let q: Omit<ParsedQuestion, 'correct'> | null = null;
  let block: { code: string; text: string; body: string[]; options: string[]; prompts: string[]; followUps: string[]; sawRadio: boolean } | null = null;

  const closeBlock = () => {
    if (!block) return;
    const b = block;
    block = null;
    const isChoice = b.options.length > 0;
    const hint = [b.text, ...b.prompts].join(' ');
    personal.push({
      code: b.code,
      kind: isChoice ? 'CHOICE' : 'TEXT',
      text: b.text,
      body: b.body.length ? b.body.join('\n\n') : null,
      options: b.options.map((text) => ({ text, signal: isPositive(text) ? 'POSITIVE' : 'NEEDS_TALK' })),
      required: true,
      flagUnlessNone: !isChoice && WRITE_NOTHING.test(hint),
      affectsStatus: true,
    });
    // "If yes, when did this happen? ...:" after the choices: an extra, optional, typed question.
    b.followUps.forEach((text, i) =>
      personal.push({ code: `${b.code}${String.fromCharCode(97 + i)}`, kind: 'TEXT', text, body: null, options: [], required: false, flagUnlessNone: false, affectsStatus: false }),
    );
  };

  for (const line of lines) {
    const s = line.match(SECTION);
    if (s) {
      closeBlock();
      section = s[1].toUpperCase() as 'A' | 'B' | 'C';
      q = null;
      continue;
    }
    if (section === 'A' || section === 'B') {
      const o = line.match(OPTION);
      if (section === 'A' && q && o) {
        q.options.push(o[2].trim());
        continue;
      }
      const m = line.match(QUESTION);
      if (m) {
        const text = m[2].replace(/\s*_{3,}\s*$/, '').trim();
        q = { number: Number(m[1]), text, options: section === 'B' ? [...tfWords] : [], kind: section === 'B' ? 'TRUE_FALSE' : 'CHOICE' };
        questions.push(q);
      }
      continue;
    }
    if (section === 'C') {
      if (/^(Signed|Sign[ée]|Signature)\b/i.test(line)) {
        closeBlock();
        break;
      }
      const p = line.match(PERSONAL);
      if (p) {
        closeBlock();
        block = { code: `C${p[1]}`, text: p[2].trim(), body: [], options: [], prompts: [], followUps: [], sawRadio: false };
        continue;
      }
      if (!block) continue;
      const r = line.match(RADIO);
      if (r) {
        block.options.push(r[1].trim());
        block.sawRadio = true;
      } else if (MY_ANSWER.test(line)) block.prompts.push(line);
      else if (block.sawRadio && /:\s*$/.test(line)) block.followUps.push(line.replace(/\s*:\s*$/, '').trim());
      else if (!block.sawRadio) block.body.push(line);
    }
  }
  closeBlock();
  return { questions, personal };
}

interface KeyParsed {
  choice: Map<number, { letter: string; text: string }>;
  tf: Map<number, boolean>;
  guide: Map<string, string>;
}

function parseKey(lines: string[]): KeyParsed {
  const choice = new Map<number, { letter: string; text: string }>();
  const tf = new Map<number, boolean>();
  const guide = new Map<string, string>();
  let inGuide = false;
  for (const line of lines) {
    const s = line.match(SECTION);
    if (s) {
      inGuide = s[1].toUpperCase() === 'C';
      continue;
    }
    if (inGuide) {
      const g = line.match(KEY_PERSONAL);
      if (g) guide.set(`C${g[1]}`, g[2].trim());
      continue;
    }
    const t = line.match(KEY_TF);
    if (t) {
      tf.set(Number(t[1]), /^(TRUE|VRAI)$/i.test(t[2]));
      continue;
    }
    const c = line.match(KEY_CHOICE);
    if (c) choice.set(Number(c[1]), { letter: c[2], text: withoutSource(c[3]) });
  }
  return { choice, tf, guide };
}

/**
 * Reads every set found in the text. `affects` lets the caller say which
 * personal questions do not decide the person's status (by set number and code),
 * `positive` which options are the clear "yes" where the words alone do not show it.
 */
export function parseExamSets(
  raw: string,
  opts: { language?: 'EN' | 'FR'; notStatus?: Record<number, string[]>; positive?: Record<number, Record<string, number[]>> } = {},
): ParsedExamSet[] {
  const language = opts.language ?? 'EN';
  const tfWords: [string, string] = language === 'FR' ? ['VRAI', 'FAUX'] : ['TRUE', 'FALSE'];
  const segments = segmentsOf(raw);
  const out: ParsedExamSet[] = [];
  for (const paper of segments.filter((s) => !s.isKey)) {
    const warnings: string[] = [];
    const key = segments.find((s) => s.isKey && s.setNumber === paper.setNumber);
    const parsed = parsePaper(paper.lines, tfWords);
    const k = key ? parseKey(key.lines) : null;
    if (!k) warnings.push('NO_KEY');
    const questions: ParsedQuestion[] = parsed.questions.map((pq) => {
      let correct = -1;
      if (k && pq.kind === 'CHOICE') {
        const hit = k.choice.get(pq.number);
        if (hit) {
          correct = 'ABCD'.indexOf(hit.letter.toUpperCase());
          if (correct >= pq.options.length || (pq.options[correct] && norm(pq.options[correct]) !== norm(hit.text))) warnings.push(`KEY_DIFFERS:${pq.number}`);
        }
      } else if (k && pq.kind === 'TRUE_FALSE') {
        const hit = k.tf.get(pq.number);
        if (hit !== undefined) correct = hit ? 0 : 1;
      }
      if (correct < 0) warnings.push(`NO_ANSWER:${pq.number}`);
      if (pq.kind === 'CHOICE' && pq.options.length !== 4) warnings.push(`OPTIONS:${pq.number}`);
      return { ...pq, correct };
    });
    const personal: ParsedPersonalQuestion[] = parsed.personal.map((pp) => {
      const base = pp.code.replace(/[a-z]$/, '');
      const overridePositive = opts.positive?.[paper.setNumber]?.[pp.code];
      const options = overridePositive ? pp.options.map((o, i) => ({ ...o, signal: overridePositive.includes(i) ? ('POSITIVE' as const) : ('NEEDS_TALK' as const) })) : pp.options;
      return {
        ...pp,
        options,
        // A typed follow-up ("If yes, when did this happen?") has no guide of its own.
        guide: /[a-z]$/.test(pp.code) ? null : (k?.guide.get(base) ?? null),
        affectsStatus: pp.affectsStatus && !(opts.notStatus?.[paper.setNumber] ?? []).includes(pp.code),
      };
    });
    if (k && personal.some((p) => !p.code.match(/[a-z]$/) && !p.guide)) warnings.push('NO_GUIDE');
    out.push({ setNumber: paper.setNumber, of: paper.of, questions, personal, warnings });
  }
  return out.sort((a, b) => a.setNumber - b.setNumber);
}
