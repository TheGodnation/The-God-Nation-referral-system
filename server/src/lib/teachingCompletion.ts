import { prisma } from './prisma';

// Who did the teachings. For the teachings of an assembly (or of every assembly): each person who handed in the quiz
// of at least one of them, with how many they did and whether they passed each one. Handing in counts, whatever the
// mark: "did it" is separate from "passed it". A retake of the same teaching counts once, with the best mark.

export interface CompletionFilter {
  communityId?: string;
  includeTestData?: boolean;
}

export interface CompletionTeaching {
  id: string;
  title: string;
  titleTranslated: string | null;
  detectedLanguage: 'en' | 'fr' | null;
  assemblyName: string;
  createdAt: Date;
  passMark: number;
}

export interface CompletionPerson {
  personId: string;
  name: string;
  whatsappNumber: string;
  /** How many of the teachings they handed in the quiz for. */
  took: number;
  passed: number;
  /** Per teaching id: their best mark and whether they passed, or null when they did not do it. */
  results: Record<string, { percentage: number | null; passed: boolean | null } | null>;
  leads: string[];
  memberOf: { id: string; name: string }[];
}

export interface Completion {
  teachings: CompletionTeaching[];
  people: CompletionPerson[];
  tookAll: number;
  tookAny: number;
}

const MAX_TEACHINGS = 60;

export async function teachingCompletion(filter: CompletionFilter): Promise<Completion> {
  const teachings = await prisma.teaching.findMany({
    where: { message: { deletedAt: null }, ...(filter.communityId ? { communityId: filter.communityId } : {}) },
    orderBy: { createdAt: 'asc' },
    take: MAX_TEACHINGS,
    select: {
      id: true,
      title: true,
      titleTranslated: true,
      detectedLanguage: true,
      createdAt: true,
      assessmentId: true,
      community: { select: { name: true } },
      assessment: { select: { passMark: true } },
    },
  });
  if (teachings.length === 0) return { teachings: [], people: [], tookAll: 0, tookAny: 0 };

  const byAssessment = new Map(teachings.map((t) => [t.assessmentId, t.id]));
  const attempts = await prisma.attempt.findMany({
    where: {
      assessmentId: { in: teachings.map((t) => t.assessmentId) },
      submittedAt: { not: null },
      person: { erasedAt: null, ...(filter.includeTestData ? {} : { isTestData: false }) },
    },
    select: { personId: true, assessmentId: true, percentage: true, passed: true, person: { select: { name: true, whatsappNumber: true } } },
  });

  const people = new Map<string, CompletionPerson>();
  for (const a of attempts) {
    const teachingId = byAssessment.get(a.assessmentId)!;
    let p = people.get(a.personId);
    if (!p) {
      p = { personId: a.personId, name: a.person.name, whatsappNumber: a.person.whatsappNumber, took: 0, passed: 0, results: {}, leads: [], memberOf: [] };
      for (const t of teachings) p.results[t.id] = null;
      people.set(a.personId, p);
    }
    const best = p.results[teachingId];
    const better = !best || (a.percentage ?? -1) > (best.percentage ?? -1) || (a.passed && !best.passed);
    if (better) p.results[teachingId] = { percentage: a.percentage, passed: a.passed };
  }
  for (const p of people.values()) {
    p.took = Object.values(p.results).filter(Boolean).length;
    p.passed = Object.values(p.results).filter((r) => r?.passed).length;
  }

  const ids = Array.from(people.keys());
  const [roles, memberships] = await Promise.all([
    prisma.roleAssignment.findMany({ where: { personId: { in: ids }, roleType: 'SCOPED_LEADER', status: 'ACTIVE', communityId: { not: null } }, select: { personId: true, community: { select: { name: true } } } }),
    prisma.communityMembership.findMany({ where: { personId: { in: ids }, status: 'ACTIVE' }, select: { personId: true, community: { select: { id: true, name: true } } } }),
  ]);
  for (const r of roles) if (r.community) people.get(r.personId)?.leads.push(r.community.name);
  for (const m of memberships) people.get(m.personId)?.memberOf.push(m.community);

  const list = Array.from(people.values()).sort((a, b) => b.took - a.took || b.passed - a.passed || a.name.localeCompare(b.name));
  return {
    teachings: teachings.map((t) => ({
      id: t.id,
      title: t.title,
      titleTranslated: t.titleTranslated,
      detectedLanguage: t.detectedLanguage,
      assemblyName: t.community.name,
      createdAt: t.createdAt,
      passMark: t.assessment.passMark,
    })),
    people: list,
    tookAll: list.filter((p) => p.took === teachings.length).length,
    tookAny: list.length,
  };
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  // Never let a cell open as a spreadsheet formula.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** The same list as a spreadsheet: one row per person, one column per teaching (mark, and PASSED or NOT PASSED). */
export function completionCsv(c: Completion): string {
  const header = ['Name', 'WhatsApp', 'Teachings done', 'Teachings passed', 'Leads', ...c.teachings.map((t) => t.title)];
  const rows = c.people.map((p) => [
    p.name,
    p.whatsappNumber,
    `${p.took} of ${c.teachings.length}`,
    p.passed,
    p.leads.join('; '),
    ...c.teachings.map((t) => {
      const r = p.results[t.id];
      if (!r) return 'not done';
      return `${r.percentage === null ? '' : `${Math.round(r.percentage)}% `}${r.passed ? 'PASSED' : 'NOT PASSED'}`.trim();
    }),
  ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}
