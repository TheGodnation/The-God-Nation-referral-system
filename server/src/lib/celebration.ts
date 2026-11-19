import { z } from 'zod';
import { prisma } from './prisma';

// The "Congratulations" page for the students who finished the books. The central admin writes the words and the names and
// switches it on; anyone with the link can then read it (no sign-in). The drafts below are only suggestions shown until the
// admin saves; they contain no names.

export const DEFAULTS = {
  titleEn: 'Congratulations to our students!',
  titleFr: 'Félicitations à nos étudiants !',
  introEn: 'They have completed all 15 books of The God Nation Media & Leadership Academy.',
  introFr: "Ils ont terminé les 15 livres de The God Nation — Académie des médias et du leadership.",
  messageEn:
    "Dear students, today the Kingdom rejoices with you.\n\nYou studied, you prayed, you passed. You did not only read about the Keys and the Rights: you made them your own. This is not the end. It is the start of a new season, where you teach, you lead, and you make disciples who make disciples.\n\nStay humble. Keep growing. Keep serving. I am sure that He who began a good work in you will carry it on to completion (Philippians 1:6). We are proud of you, and we are with you.\n\nEvangelist Stanley A. Ndoh",
  messageFr:
    "Chers étudiants, aujourd'hui le Royaume se réjouit avec vous.\n\nVous avez étudié, vous avez prié, vous avez réussi. Vous n'avez pas seulement lu sur les Clés et les Droits : vous en avez fait les vôtres. Ce n'est pas la fin. C'est le début d'une nouvelle saison, où vous enseignez, vous dirigez, et vous faites des disciples qui font des disciples.\n\nRestez humbles. Continuez à grandir. Continuez à servir. Celui qui a commencé en vous cette bonne œuvre la rendra parfaite (Philippiens 1.6). Nous sommes fiers de vous, et nous sommes avec vous.\n\nÉvangéliste Stanley A. Ndoh",
};

export const celebrationSchema = z.object({
  published: z.boolean(),
  titleEn: z.string().trim().max(200),
  titleFr: z.string().trim().max(200),
  introEn: z.string().trim().max(600),
  introFr: z.string().trim().max(600),
  messageEn: z.string().trim().max(4000),
  messageFr: z.string().trim().max(4000),
  names: z.array(z.string().trim().min(1).max(200)).max(500),
});
export type CelebrationInput = z.infer<typeof celebrationSchema>;

const cleanNames = (raw: unknown): string[] => (Array.isArray(raw) ? raw.filter((n): n is string => typeof n === 'string' && n.trim() !== '').map((n) => n.trim()) : []);

/** What the admin sees: what was saved, or the drafts when nothing is saved yet. */
export async function adminCelebration() {
  const row = await prisma.celebration.findUnique({ where: { id: 'main' } });
  if (!row) return { saved: false, published: false, ...DEFAULTS, names: [] as string[] };
  return {
    saved: true,
    published: row.published,
    titleEn: row.titleEn || DEFAULTS.titleEn,
    titleFr: row.titleFr || DEFAULTS.titleFr,
    introEn: row.introEn || DEFAULTS.introEn,
    introFr: row.introFr || DEFAULTS.introFr,
    messageEn: row.messageEn || DEFAULTS.messageEn,
    messageFr: row.messageFr || DEFAULTS.messageFr,
    names: cleanNames(row.names),
  };
}

export async function saveCelebration(input: CelebrationInput) {
  const data = { ...input, names: input.names as unknown as object };
  await prisma.celebration.upsert({ where: { id: 'main' }, create: { id: 'main', ...data }, update: data });
  return adminCelebration();
}

/** What a visitor sees: only when it is switched on. */
export async function publicCelebration() {
  const row = await prisma.celebration.findUnique({ where: { id: 'main' } });
  if (!row || !row.published) return null;
  const names = cleanNames(row.names);
  return {
    title: { en: row.titleEn || DEFAULTS.titleEn, fr: row.titleFr || row.titleEn || DEFAULTS.titleFr },
    intro: { en: row.introEn || DEFAULTS.introEn, fr: row.introFr || row.introEn || DEFAULTS.introFr },
    message: { en: row.messageEn || DEFAULTS.messageEn, fr: row.messageFr || row.messageEn || DEFAULTS.messageFr },
    names,
  };
}

/** The names on the weekly teaching list (the member's own name when matched, else the name from the plan), to save typing them. */
export async function teachingListNames(): Promise<string[]> {
  const teachers = await prisma.teachingTeacher.findMany({ where: { active: true }, orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }], select: { name: true, personId: true } });
  const people = await prisma.person.findMany({ where: { id: { in: teachers.map((t) => t.personId).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } });
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  return teachers.map((t) => (t.personId ? nameOf.get(t.personId) : null) ?? t.name);
}
