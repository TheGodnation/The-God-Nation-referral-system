import { prisma } from './prisma';
import { notifyGiftDecision } from './notifications';

// ---------------------------------------------------------------------------
// Giving. A member gives by Mobile Money to the central administration and
// says so with the transaction ID; the central admin confirms. Leaders never
// see who gave: nothing here is exposed to a leader, and totals per assembly
// are for the central admin only. Offerings, tithes and free-will gifts are
// never listed publicly. A help-one-another campaign has a public report with
// names and amounts; a giver may appear as "Anonymous".
// ---------------------------------------------------------------------------

export const MIN_GIFT = 100;
export const MAX_GIFT = 10_000_000;

export type GiftKindName = 'OFFERING' | 'TITHE' | 'FREE_WILL' | 'CAMPAIGN';
export const GIFT_KINDS: GiftKindName[] = ['OFFERING', 'TITHE', 'FREE_WILL', 'CAMPAIGN'];

export async function givingInstructions(language: 'en' | 'fr'): Promise<string> {
  const s = await prisma.settings.findUnique({ where: { id: 'singleton' }, select: { givingInstructionsEn: true, givingInstructionsFr: true } });
  const pick = language === 'fr' ? s?.givingInstructionsFr || s?.givingInstructionsEn : s?.givingInstructionsEn || s?.givingInstructionsFr;
  return pick?.trim() ?? '';
}

export type CreateGiftResult = { ok: true; id: string } | { ok: false; status: 400; error: string };

export async function createGift(opts: {
  personId: string;
  kind: GiftKindName;
  campaignId?: string | null;
  amount: number;
  reference: string;
  payerPhone?: string | null;
  anonymous?: boolean;
}): Promise<CreateGiftResult> {
  if (!Number.isInteger(opts.amount) || opts.amount < MIN_GIFT || opts.amount > MAX_GIFT) {
    return { ok: false, status: 400, error: `The amount must be a whole number from ${MIN_GIFT} to ${MAX_GIFT.toLocaleString('en-US')} FCFA.` };
  }
  let campaignId: string | null = null;
  if (opts.kind === 'CAMPAIGN') {
    const campaign = opts.campaignId ? await prisma.giftCampaign.findUnique({ where: { id: opts.campaignId }, select: { id: true, status: true } }) : null;
    if (!campaign || campaign.status !== 'OPEN') return { ok: false, status: 400, error: 'This campaign is not open for gifts.' };
    campaignId = campaign.id;
  }
  const membership = await prisma.communityMembership.findFirst({ where: { personId: opts.personId, status: 'ACTIVE' }, select: { communityId: true }, orderBy: { joinedAt: 'asc' } });
  const gift = await prisma.gift.create({
    data: {
      personId: opts.personId,
      communityId: membership?.communityId ?? null,
      kind: opts.kind,
      campaignId,
      amount: opts.amount,
      reference: opts.reference.trim(),
      payerPhone: opts.payerPhone?.trim() || null,
      // Only a campaign has a public report, so only there can a giver choose to be anonymous.
      anonymous: opts.kind === 'CAMPAIGN' ? Boolean(opts.anonymous) : false,
    },
  });
  return { ok: true, id: gift.id };
}

export type DecideGiftResult = { ok: true; status: 'CONFIRMED' | 'REJECTED' } | { ok: false; status: 404 | 409; error: string };

export async function decideGift(id: string, decision: 'CONFIRM' | 'REJECT', byUserId: string | null, note?: string): Promise<DecideGiftResult> {
  const existing = await prisma.gift.findUnique({ where: { id } });
  if (!existing) return { ok: false, status: 404, error: 'Gift not found.' };
  if (existing.status !== 'CLAIMED') return { ok: false, status: 409, error: 'This gift has already been decided.' };
  const confirmed = decision === 'CONFIRM';
  const changed = await prisma.gift.updateMany({
    where: { id, status: 'CLAIMED' },
    data: { status: confirmed ? 'CONFIRMED' : 'REJECTED', decidedAt: new Date(), decidedByUserId: byUserId, note: note?.trim() || null },
  });
  if (changed.count === 0) return { ok: false, status: 409, error: 'This gift has already been decided.' };
  await notifyGiftDecision(existing, confirmed).catch(() => {});
  return { ok: true, status: confirmed ? 'CONFIRMED' : 'REJECTED' };
}

export interface GivingSummary {
  confirmedTotal: number;
  confirmedCount: number;
  waitingCount: number;
  byKind: { kind: GiftKindName; total: number; count: number }[];
  byAssembly: { communityId: string | null; name: string | null; total: number; count: number }[];
}

/** Totals for the central admin only: overall, by kind, and per assembly. Confirmed gifts only. */
export async function givingSummary(): Promise<GivingSummary> {
  const [byKind, byAssembly, waiting] = await Promise.all([
    prisma.gift.groupBy({ by: ['kind'], where: { status: 'CONFIRMED' }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.gift.groupBy({ by: ['communityId'], where: { status: 'CONFIRMED' }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.gift.count({ where: { status: 'CLAIMED' } }),
  ]);
  const communities = await prisma.community.findMany({ where: { id: { in: byAssembly.map((a) => a.communityId).filter((id): id is string => Boolean(id)) } }, select: { id: true, name: true } });
  const nameOf = new Map(communities.map((c) => [c.id, c.name]));
  return {
    confirmedTotal: byKind.reduce((n, k) => n + (k._sum.amount ?? 0), 0),
    confirmedCount: byKind.reduce((n, k) => n + k._count._all, 0),
    waitingCount: waiting,
    byKind: GIFT_KINDS.map((kind) => {
      const row = byKind.find((k) => k.kind === kind);
      return { kind, total: row?._sum.amount ?? 0, count: row?._count._all ?? 0 };
    }),
    byAssembly: byAssembly
      .map((a) => ({ communityId: a.communityId, name: a.communityId ? (nameOf.get(a.communityId) ?? null) : null, total: a._sum.amount ?? 0, count: a._count._all }))
      .sort((a, b) => b.total - a.total),
  };
}

/** Gifts waiting for the central admin's confirmation, oldest first, with the giver's name and assembly. */
export async function waitingGifts() {
  const gifts = await prisma.gift.findMany({ where: { status: 'CLAIMED' }, orderBy: { createdAt: 'asc' }, take: 200, include: { person: { select: { name: true } }, campaign: { select: { titleEn: true } } } });
  const communities = await prisma.community.findMany({ where: { id: { in: gifts.map((g) => g.communityId).filter((id): id is string => Boolean(id)) } }, select: { id: true, name: true } });
  const nameOf = new Map(communities.map((c) => [c.id, c.name]));
  return gifts.map((g) => ({
    id: g.id,
    giverName: g.person?.name ?? null,
    assemblyName: g.communityId ? (nameOf.get(g.communityId) ?? null) : null,
    kind: g.kind,
    campaignTitle: g.campaign?.titleEn ?? null,
    amount: g.amount,
    reference: g.reference,
    payerPhone: g.payerPhone,
    anonymous: g.anonymous,
    createdAt: g.createdAt.toISOString(),
  }));
}

export interface CampaignView {
  id: string;
  titleEn: string;
  titleFr: string | null;
  descriptionEn: string | null;
  descriptionFr: string | null;
  targetAmount: number | null;
  status: 'OPEN' | 'CLOSED';
  raised: number;
  giftCount: number;
  createdAt: string;
}

export async function campaignsWithTotals(onlyOpen: boolean): Promise<CampaignView[]> {
  const campaigns = await prisma.giftCampaign.findMany({ where: onlyOpen ? { status: 'OPEN' } : {}, orderBy: { createdAt: 'desc' }, take: 100 });
  const totals = await prisma.gift.groupBy({
    by: ['campaignId'],
    where: { campaignId: { in: campaigns.map((c) => c.id) }, status: 'CONFIRMED' },
    _sum: { amount: true },
    _count: { _all: true },
  });
  const totalOf = new Map(totals.map((t) => [t.campaignId, t]));
  return campaigns.map((c) => ({
    id: c.id,
    titleEn: c.titleEn,
    titleFr: c.titleFr,
    descriptionEn: c.descriptionEn,
    descriptionFr: c.descriptionFr,
    targetAmount: c.targetAmount,
    status: c.status,
    raised: totalOf.get(c.id)?._sum.amount ?? 0,
    giftCount: totalOf.get(c.id)?._count._all ?? 0,
    createdAt: c.createdAt.toISOString(),
  }));
}

/**
 * The public report of one campaign: who gave and how much — by name, or
 * "Anonymous" when the giver asked. Confirmed campaign gifts only; offerings,
 * tithes and free-will gifts are never part of any list.
 */
export async function campaignReport(campaignId: string) {
  const campaign = await prisma.giftCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign) return null;
  const gifts = await prisma.gift.findMany({
    where: { campaignId, kind: 'CAMPAIGN', status: 'CONFIRMED' },
    orderBy: { decidedAt: 'asc' },
    select: { id: true, amount: true, anonymous: true, decidedAt: true, createdAt: true, person: { select: { name: true } } },
  });
  return {
    campaign: (await campaignsWithTotals(false)).find((c) => c.id === campaignId)!,
    gifts: gifts.map((g) => ({
      id: g.id,
      // Anonymous givers (and givers whose account was deleted) never show a name.
      name: g.anonymous || !g.person ? null : g.person.name,
      amount: g.amount,
      date: (g.decidedAt ?? g.createdAt).toISOString(),
    })),
  };
}

export async function myGifts(personId: string) {
  const gifts = await prisma.gift.findMany({ where: { personId }, orderBy: { createdAt: 'desc' }, take: 100, include: { campaign: { select: { titleEn: true, titleFr: true } } } });
  return gifts.map((g) => ({
    id: g.id,
    kind: g.kind,
    campaignTitleEn: g.campaign?.titleEn ?? null,
    campaignTitleFr: g.campaign?.titleFr ?? null,
    amount: g.amount,
    status: g.status,
    anonymous: g.anonymous,
    createdAt: g.createdAt.toISOString(),
  }));
}
