import type { Prisma, CertificateRequest } from '@prisma/client';
import { prisma } from './prisma';
import { getTrainingBooksFor } from './examWorld';
import { programmeBookTotal } from './trainingTotal';

// ---------------------------------------------------------------------------
// The Academy diploma. A student who has passed every book can ask for it, typing their name exactly as it should be
// printed and choosing how to receive it (posted, emailed / WhatsApped to print, or collected). The price is agreed
// privately by the central admin (the private note is never shown to the student). When it is issued it gets a number
// GNLA-2026-001 (counting up each year) and the date.
// ---------------------------------------------------------------------------

export const NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M}\s'’.\-]{1,79}$/u;

/**
 * Passed every book of the programme: all the books on the site, and all of the programme's books (16) even if the last
 * ones are not on the site yet. Adding a new book later means passing that one too.
 */
export async function certificateEligibility(personId: string): Promise<{ eligible: boolean; passed: number; total: number }> {
  const books = await getTrainingBooksFor(personId);
  const passed = books.filter((b) => b.exam?.passed).length;
  const total = await programmeBookTotal(books.length);
  return { eligible: books.length > 0 && passed === books.length && books.length >= total, passed, total };
}

export function cleanName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

type Tx = Prisma.TransactionClient;

/** The next number for a year: GNLA-2026-001, -002, ... (a unique index guards against two issued at once). */
export async function nextCertificateNumber(tx: Tx, year: number): Promise<string> {
  const prefix = `GNLA-${year}-`;
  const last = await tx.certificateRequest.findMany({ where: { certificateNumber: { startsWith: prefix } }, select: { certificateNumber: true } });
  const highest = last.reduce((max, r) => Math.max(max, Number((r.certificateNumber ?? '').slice(prefix.length)) || 0), 0);
  return `${prefix}${String(highest + 1).padStart(3, '0')}`;
}

/** Issues the certificate: gives it its number and date. Retries if another was issued at the same moment. */
export async function issueCertificate(id: string, now = new Date()): Promise<CertificateRequest> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const row = await tx.certificateRequest.findUnique({ where: { id } });
        if (!row) throw new CertificateError('NOT_FOUND', 'Request not found.');
        if (row.status === 'ISSUED' || row.status === 'DELIVERED') return row;
        if (row.status === 'CANCELLED') throw new CertificateError('CANCELLED', 'This request was cancelled.');
        const number = await nextCertificateNumber(tx, now.getFullYear());
        return tx.certificateRequest.update({ where: { id }, data: { status: 'ISSUED', certificateNumber: number, issuedAt: now, paidAt: row.paidAt ?? now } });
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') continue;
      throw err;
    }
  }
  throw new CertificateError('BUSY', 'Please try again.');
}

export class CertificateError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

/** What the student may see: never the private note; the number and date only once it is issued. */
export function studentView(row: CertificateRequest) {
  const issued = row.status === 'ISSUED' || row.status === 'DELIVERED';
  return {
    status: row.status,
    nameOnCertificate: row.nameOnCertificate,
    language: row.language === 'fr' ? 'fr' : 'en',
    delivery: row.delivery,
    contactPhone: row.contactPhone,
    address: row.address,
    requestedAt: row.requestedAt,
    certificateNumber: issued ? row.certificateNumber : null,
    issuedAt: issued ? row.issuedAt : null,
    deliveredAt: row.status === 'DELIVERED' ? row.deliveredAt : null,
  };
}
