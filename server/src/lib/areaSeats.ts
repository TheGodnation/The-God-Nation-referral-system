import { Prisma, type GeographicLevel } from '@prisma/client';
import { prisma } from './prisma';
import { titleForLevel } from './geographicAreas';

// A subdivision has up to five representatives (first to fifth): whoever is approved takes the first free seat.
// A person can also represent ONE quarter, besides a seat in a subdivision. The central admin can still name
// each position (the `title` of an assignment), which then replaces the usual title.
export const SUBDIVISION_SEATS = 5;
const ORDINALS = ['First', 'Second', 'Third', 'Fourth', 'Fifth'];

export function seatTitle(seat: number): string {
  return `${ORDINALS[seat - 1] ?? `#${seat}`} Subdivision Representative`;
}

/** The title shown for a position: the admin's own words, else "Second Subdivision Representative", else the level's usual title. */
export function positionTitle(level: GeographicLevel, seat: number | null | undefined, custom?: string | null): string {
  if (custom) return custom;
  if (level === 'SUBDIVISION' && seat) return seatTitle(seat);
  return titleForLevel(level);
}

export class AreaRuleError extends Error {
  constructor(
    public status: number,
    public code: 'SUBDIVISION_FULL' | 'ALREADY_QUARTER' | 'ALREADY_LEADS',
    message: string,
  ) {
    super(message);
  }
}

export const SUBDIVISION_FULL_MESSAGE = `This subdivision already has its ${SUBDIVISION_SEATS} representatives. You can ask to represent a quarter within it.`;
export const ALREADY_QUARTER_MESSAGE = 'You already represent a quarter. One person can represent only one quarter.';

/** Seats taken in a subdivision (active only), in seat order. */
export async function seatsOf(areaId: string) {
  const rows = await prisma.areaLeadershipAssignment.findMany({
    where: { areaId, status: 'ACTIVE' },
    select: { seat: true, person: { select: { name: true } } },
    orderBy: [{ seat: 'asc' }, { assignedAt: 'asc' }],
  });
  const taken = new Set(rows.map((r) => r.seat).filter((s): s is number => s !== null));
  let nextSeat: number | null = null;
  for (let s = 1; s <= SUBDIVISION_SEATS; s += 1) if (!taken.has(s)) { nextSeat = s; break; }
  // People appointed before seats existed (no number) still count against the five.
  const full = rows.length >= SUBDIVISION_SEATS || nextSeat === null;
  return { count: rows.length, full, nextSeat: full ? null : nextSeat, names: rows.map((r) => r.person.name) };
}

/** Whether this person already represents a quarter. */
export async function representsAQuarter(personId: string): Promise<boolean> {
  return (await prisma.areaLeadershipAssignment.count({ where: { personId, status: 'ACTIVE', area: { level: 'QUARTER' } } })) > 0;
}

/**
 * Appoints a person to an area, with the rules: a subdivision takes up to five representatives (the first free seat
 * is given), and nobody represents two quarters. Throws AreaRuleError (409) when a rule stops it.
 */
export async function appointToArea(opts: { personId: string; areaId: string; level: GeographicLevel; title?: string | null; assignedByUserId: string }) {
  const { personId, areaId, level } = opts;
  if (level === 'QUARTER' && (await representsAQuarter(personId))) {
    // The same quarter again is "already leads"; any other quarter is the one-quarter rule.
    const same = await prisma.areaLeadershipAssignment.count({ where: { personId, areaId, status: 'ACTIVE' } });
    if (same > 0) throw new AreaRuleError(409, 'ALREADY_LEADS', 'This Person already actively leads this Area.');
    throw new AreaRuleError(409, 'ALREADY_QUARTER', 'This person already represents a quarter. One person can represent only one quarter.');
  }
  for (let attempt = 0; attempt < 6; attempt += 1) {
    let seat: number | null = null;
    if (level === 'SUBDIVISION') {
      const seats = await seatsOf(areaId);
      if (seats.full || seats.nextSeat === null) throw new AreaRuleError(409, 'SUBDIVISION_FULL', `This subdivision already has its ${SUBDIVISION_SEATS} representatives.`);
      seat = seats.nextSeat;
    }
    try {
      return await prisma.areaLeadershipAssignment.create({ data: { personId, areaId, title: opts.title || null, seat, assignedByUserId: opts.assignedByUserId } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const target = String((err.meta as { target?: unknown } | undefined)?.target ?? '');
        // Two people took the same seat at the same moment: look again for a free one.
        if (target.includes('seat')) continue;
        throw new AreaRuleError(409, 'ALREADY_LEADS', 'This Person already actively leads this Area.');
      }
      throw err;
    }
  }
  throw new AreaRuleError(409, 'SUBDIVISION_FULL', `This subdivision already has its ${SUBDIVISION_SEATS} representatives.`);
}
