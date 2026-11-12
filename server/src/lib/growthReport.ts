import { prisma } from './prisma';

// The growth report: for people who joined in the last N days, how far each
// one got (the funnel), grouped by where they came from and by ambassador.
// Read-only; built from what is already recorded. Test data is left out.

const DAY = 24 * 60 * 60 * 1000;
const MAX_REGISTRATIONS = 20000;

export interface FunnelCounts {
  visitors: number;
  leads: number;
  registered: number;
  confirmed: number;
  profileCompleted: number;
  joinedGroup: number;
  /** Said, themselves, that they joined (self-reported; a tap on a link is `joinedGroup`). */
  saysJoined: number;
  firstChat: number;
  firstExam: number;
  returned7: number;
  returned30: number;
}

export interface GrowthRow extends FunnelCounts {
  key: string;
  source: string;
  campaign: string | null;
}

export interface PlatformRow {
  platform: string;
  taps: number;
}

export interface AmbassadorRow {
  name: string;
  registered: number;
  confirmed: number;
  profileCompleted: number;
  returned7: number;
}

const empty = (): FunnelCounts => ({ visitors: 0, leads: 0, registered: 0, confirmed: 0, profileCompleted: 0, joinedGroup: 0, saysJoined: 0, firstChat: 0, firstExam: 0, returned7: 0, returned30: 0 });

interface Origin {
  utmSource: string | null;
  utmCampaign: string | null;
  fbclid: string | null;
  ttclid: string | null;
  gclid: string | null;
  referrerHost: string | null;
  referralCodeId: string | null;
}

/** A readable name for where someone came from: the ad source if there is one, else the platform behind the click code, an ambassador link, the website they came from, or "direct". */
export function sourceOf(o: Origin): string {
  if (o.utmSource) return o.utmSource.toLowerCase();
  if (o.fbclid) return 'facebook';
  if (o.ttclid) return 'tiktok';
  if (o.gclid) return 'google';
  if (o.referralCodeId) return 'ambassador link';
  if (o.referrerHost) return o.referrerHost;
  return 'direct';
}

/**
 * How many members will actually receive phone notifications: members who have at least one subscribed phone, out of all
 * members. Everyone with an account counts (not only the period of the report); erased and test accounts do not.
 * A subscription the push service says is gone is removed automatically when a send finds it (lib/push.ts), so this
 * count only drifts from the truth by phones that were switched off or changed since the last notification.
 */
export async function notificationsOn() {
  const memberWhere = { erasedAt: null, deletionRequestedAt: null, isTestData: false, memberAccount: { isNot: null } };
  const [totalMembers, withPush, subscriptions] = await Promise.all([
    prisma.person.count({ where: memberWhere }),
    prisma.person.count({ where: { ...memberWhere, pushSubscriptions: { some: {} } } }),
    prisma.pushSubscription.count({ where: { person: { is: memberWhere } } }),
  ]);
  return { totalMembers, membersWithPush: withPush, subscriptions };
}

export async function growthReport(days: number, now = new Date()) {
  const since = new Date(now.getTime() - days * DAY);

  const [visits, leads, registrations] = await Promise.all([
    prisma.referralVisit.findMany({
      where: { timestamp: { gte: since }, isTestData: false },
      select: { visitorId: true, utmSource: true, utmCampaign: true, fbclid: true, ttclid: true, gclid: true, referrerHost: true, referralCodeId: true },
    }),
    prisma.lead.findMany({
      where: { createdAt: { gte: since }, isTestData: false },
      select: { utmSource: true, utmCampaign: true, fbclid: true, ttclid: true, gclid: true, referrerHost: true, referralCodeId: true },
    }),
    prisma.registration.findMany({
      where: { createdAt: { gte: since }, isTestData: false, personId: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: MAX_REGISTRATIONS,
      select: {
        id: true, personId: true, createdAt: true,
        utmSource: true, utmCampaign: true, fbclid: true, ttclid: true, gclid: true, referrerHost: true, referralCodeId: true,
        person: { select: { profileCompletedAt: true, lastSeenAt: true, memberAccount: { select: { lastLoginAt: true } } } },
        referralCode: { select: { person: { select: { name: true } }, leader: { select: { name: true } } } },
      },
    }),
  ]);

  const regIds = registrations.map((r) => r.id);
  const personIds = registrations.map((r) => r.personId!).filter(Boolean);
  const [groupClicks, chatters, examTakers, platformTaps, selfConfirmed] = await Promise.all([
    prisma.event.findMany({ where: { type: 'GROUP_LINK_CLICKED', registrationId: { in: regIds } }, select: { registrationId: true }, distinct: ['registrationId'] }),
    prisma.message.findMany({ where: { senderPersonId: { in: personIds }, deletedAt: null, kind: 'USER' }, select: { senderPersonId: true }, distinct: ['senderPersonId'] }),
    prisma.attempt.findMany({ where: { personId: { in: personIds }, status: 'SUBMITTED' }, select: { personId: true }, distinct: ['personId'] }),
    // Every tap in the period on a group, channel or page (members and visitors who left a number).
    prisma.event.groupBy({ by: ['detail'], where: { type: 'GROUP_LINK_CLICKED', timestamp: { gte: since }, isTestData: false }, _count: { _all: true } }),
    prisma.memberOnboarding.findMany({ where: { personId: { in: personIds }, communityConfirmedAt: { not: null } }, select: { personId: true } }),
  ]);
  const clicked = new Set(groupClicks.map((e) => e.registrationId));
  const chatted = new Set(chatters.map((m) => m.senderPersonId));
  const examined = new Set(examTakers.map((a) => a.personId));
  const saidJoined = new Set(selfConfirmed.map((m) => m.personId));

  const rows = new Map<string, GrowthRow>();
  const totals = empty();
  const row = (o: Origin): GrowthRow => {
    const source = sourceOf(o);
    const campaign = o.utmCampaign || null;
    const key = `${source}|${campaign ?? ''}`;
    let r = rows.get(key);
    if (!r) rows.set(key, (r = { key, source, campaign, ...empty() }));
    return r;
  };

  // Visitors: each person counted once per row they appear in.
  const seen = new Map<string, Set<string>>();
  const allVisitors = new Set<string>();
  for (const v of visits) {
    const r = row(v);
    const set = seen.get(r.key) ?? new Set<string>();
    if (!set.has(v.visitorId)) {
      set.add(v.visitorId);
      r.visitors += 1;
    }
    seen.set(r.key, set);
    allVisitors.add(v.visitorId);
  }
  totals.visitors = allVisitors.size;
  for (const l of leads) {
    row(l).leads += 1;
    totals.leads += 1;
  }

  const ambassadors = new Map<string, AmbassadorRow>();
  for (const reg of registrations) {
    const r = row(reg);
    const p = reg.person!;
    const confirmed = Boolean(p.memberAccount?.lastLoginAt);
    const completed = Boolean(p.profileCompletedAt);
    const returnedAfter = (d: number) => Boolean(p.lastSeenAt && p.lastSeenAt.getTime() >= reg.createdAt.getTime() + d * DAY);
    const steps: Partial<FunnelCounts> = {
      registered: 1,
      confirmed: confirmed ? 1 : 0,
      profileCompleted: completed ? 1 : 0,
      joinedGroup: clicked.has(reg.id) ? 1 : 0,
      saysJoined: saidJoined.has(reg.personId!) ? 1 : 0,
      firstChat: chatted.has(reg.personId!) ? 1 : 0,
      firstExam: examined.has(reg.personId!) ? 1 : 0,
      returned7: returnedAfter(7) ? 1 : 0,
      returned30: returnedAfter(30) ? 1 : 0,
    };
    for (const k of Object.keys(steps) as (keyof FunnelCounts)[]) {
      r[k] += steps[k] ?? 0;
      totals[k] += steps[k] ?? 0;
    }
    if (reg.referralCodeId && reg.referralCode) {
      const name = reg.referralCode.person?.name ?? reg.referralCode.leader?.name ?? 'Unknown';
      const a = ambassadors.get(reg.referralCodeId) ?? { name, registered: 0, confirmed: 0, profileCompleted: 0, returned7: 0 };
      a.registered += 1;
      a.confirmed += steps.confirmed ?? 0;
      a.profileCompleted += steps.profileCompleted ?? 0;
      a.returned7 += steps.returned7 ?? 0;
      ambassadors.set(reg.referralCodeId, a);
    }
  }

  return {
    days,
    since: since.toISOString(),
    totals,
    bySource: [...rows.values()].sort((a, b) => b.registered - a.registered || b.visitors - a.visitors),
    byAmbassador: [...ambassadors.values()].sort((a, b) => b.registered - a.registered).slice(0, 25),
    byPlatform: platformTaps
      .map((p): PlatformRow => ({ platform: p.detail ?? 'unknown', taps: p._count._all }))
      .sort((a, b) => b.taps - a.taps),
    truncated: registrations.length >= MAX_REGISTRATIONS,
    notifications: await notificationsOn(),
  };
}
