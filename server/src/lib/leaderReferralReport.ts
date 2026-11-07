import { prisma } from './prisma';

// The first referral system, per leader: how many people clicked their link, how many signed up through it, how many
// then tapped "join our WhatsApp group", how many are now in the app and in an assembly. These numbers come from the
// records of the link (visits) and of the sign-ups attributed to the leader; they stay exactly as they were.
// "Tapped join the group" is a tap on the WhatsApp join button, not proof of joining inside WhatsApp (WhatsApp does not
// tell the app who actually joined).

export interface LeaderReferralRow {
  leaderId: string;
  name: string;
  email: string;
  active: boolean;
  codes: string[];
  /** Clicks on the leader's link, and different people among them. */
  visits: number;
  uniqueVisitors: number;
  /** Signed up through the link. */
  referred: number;
  /** Of those, who tapped to join a WhatsApp group. */
  tappedGroup: number;
  /** Of those, who now have a profile in the app (finished their details). */
  inApp: number;
  /** Of those, who are now in at least one assembly. */
  inAssembly: number;
  /** Signed up / different visitors, in percent. */
  conversionRate: number;
  firstReferralAt: Date | null;
  lastReferralAt: Date | null;
}

export interface LeaderReferralReport {
  rows: LeaderReferralRow[];
  totals: Omit<LeaderReferralRow, 'leaderId' | 'name' | 'email' | 'active' | 'codes' | 'firstReferralAt' | 'lastReferralAt'>;
}

const GROUP_EVENTS = ['WHATSAPP_CLICKED', 'GROUP_LINK_CLICKED'] as const;

export async function leaderReferralReport(opts: { includeTestData?: boolean } = {}): Promise<LeaderReferralReport> {
  const includeTestData = Boolean(opts.includeTestData);
  const leaders = await prisma.user.findMany({
    where: { role: 'LEADER', ...(includeTestData ? {} : { isTestData: false }) },
    select: { id: true, name: true, email: true, active: true, referralCodes: { select: { id: true, code: true } } },
  });
  if (leaders.length === 0) return { rows: [], totals: emptyTotals() };

  const leaderIds = leaders.map((l) => l.id);
  const codeOwner = new Map<string, string>();
  for (const l of leaders) for (const c of l.referralCodes) codeOwner.set(c.id, l.id);
  const codeIds = Array.from(codeOwner.keys());

  const [visits, uniqueVisits, relationships, groupEvents] = await Promise.all([
    prisma.referralVisit.groupBy({ by: ['referralCodeId'], where: { referralCodeId: { in: codeIds } }, _count: { _all: true } }),
    prisma.referralVisit.findMany({ where: { referralCodeId: { in: codeIds } }, select: { referralCodeId: true, visitorId: true }, distinct: ['referralCodeId', 'visitorId'] }),
    prisma.referralRelationship.findMany({
      where: { leaderId: { in: leaderIds }, ...(includeTestData ? {} : { registration: { isTestData: false } }) },
      select: {
        leaderId: true,
        registrationId: true,
        createdAt: true,
        registration: {
          select: {
            person: { select: { profileCompletedAt: true, memberAccount: { select: { id: true } }, communityMemberships: { where: { status: 'ACTIVE' }, select: { id: true }, take: 1 } } },
          },
        },
      },
    }),
    prisma.event.findMany({
      where: { type: { in: [...GROUP_EVENTS] }, registration: { relationship: { leaderId: { in: leaderIds } } } },
      select: { registrationId: true },
      distinct: ['registrationId'],
    }),
  ]);

  const visitsBy = new Map<string, number>();
  for (const v of visits) if (v.referralCodeId) visitsBy.set(codeOwner.get(v.referralCodeId)!, (visitsBy.get(codeOwner.get(v.referralCodeId)!) ?? 0) + v._count._all);
  const uniqueBy = new Map<string, number>();
  for (const v of uniqueVisits) if (v.referralCodeId) uniqueBy.set(codeOwner.get(v.referralCodeId)!, (uniqueBy.get(codeOwner.get(v.referralCodeId)!) ?? 0) + 1);
  const tapped = new Set(groupEvents.map((e) => e.registrationId));

  const rows: LeaderReferralRow[] = leaders.map((l) => {
    const mine = relationships.filter((r) => r.leaderId === l.id);
    const dates = mine.map((r) => r.createdAt.getTime());
    const uniqueVisitors = uniqueBy.get(l.id) ?? 0;
    return {
      leaderId: l.id,
      name: l.name,
      email: l.email,
      active: l.active,
      codes: l.referralCodes.map((c) => c.code),
      visits: visitsBy.get(l.id) ?? 0,
      uniqueVisitors,
      referred: mine.length,
      tappedGroup: mine.filter((r) => tapped.has(r.registrationId)).length,
      inApp: mine.filter((r) => r.registration.person?.memberAccount && r.registration.person.profileCompletedAt).length,
      inAssembly: mine.filter((r) => (r.registration.person?.communityMemberships.length ?? 0) > 0).length,
      conversionRate: uniqueVisitors > 0 ? Math.round((mine.length / uniqueVisitors) * 10000) / 100 : 0,
      firstReferralAt: dates.length ? new Date(Math.min(...dates)) : null,
      lastReferralAt: dates.length ? new Date(Math.max(...dates)) : null,
    };
  });
  rows.sort((a, b) => b.referred - a.referred || b.visits - a.visits || a.name.localeCompare(b.name));

  const sum = (f: (r: LeaderReferralRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const uniqueVisitors = sum((r) => r.uniqueVisitors);
  const referred = sum((r) => r.referred);
  return {
    rows,
    totals: {
      visits: sum((r) => r.visits),
      uniqueVisitors,
      referred,
      tappedGroup: sum((r) => r.tappedGroup),
      inApp: sum((r) => r.inApp),
      inAssembly: sum((r) => r.inAssembly),
      conversionRate: uniqueVisitors > 0 ? Math.round((referred / uniqueVisitors) * 10000) / 100 : 0,
    },
  };
}

function emptyTotals(): LeaderReferralReport['totals'] {
  return { visits: 0, uniqueVisitors: 0, referred: 0, tappedGroup: 0, inApp: 0, inAssembly: 0, conversionRate: 0 };
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** The report as a spreadsheet: one row per leader, then a total row. */
export function leaderReferralCsv(report: LeaderReferralReport): string {
  const header = ['Leader', 'Email', 'Account', 'Link code(s)', 'Link clicks', 'Different visitors', 'Signed up through the link', 'Tapped "join the WhatsApp group"', 'Now in the app', 'Now in an assembly', 'Conversion %', 'First sign-up', 'Latest sign-up'];
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '');
  const rows = report.rows.map((r) => [r.name, r.email, r.active ? 'active' : 'turned off', r.codes.join('; '), r.visits, r.uniqueVisitors, r.referred, r.tappedGroup, r.inApp, r.inAssembly, r.conversionRate, day(r.firstReferralAt), day(r.lastReferralAt)]);
  const t = report.totals;
  rows.push(['TOTAL', '', '', '', t.visits, t.uniqueVisitors, t.referred, t.tappedGroup, t.inApp, t.inAssembly, t.conversionRate, '', '']);
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}
