import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import request from 'supertest';

// Whether the test student has passed every book (the real rule is in lib/examWorld.ts).
const state = { passedAll: true };
vi.mock('../lib/examWorld', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/examWorld')>();
  return {
    ...actual,
    getTrainingBooksFor: vi.fn(async () => [
      { id: 'b1', exam: { passed: true } },
      { id: 'b2', exam: { passed: state.passedAll } },
    ]),
  };
});

import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { createAdmin } from './helpers';
import { bootstrap } from './testUtils';

// The Academy diploma: a student who passed every book asks for it (name as printed, how to receive it); the central
// admin keeps a private note (the price), marks it paid, issues it (number GNLA-year-001, 002...), and marks it delivered.
const app = createApp();

let ipCounter = 0;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.121.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', ip);
  return wrapped;
}
type Who = { agent: ReturnType<typeof agentWithUniqueIp>; csrf: string; id?: string };

let n = 0;
async function member(name: string): Promise<Who & { id: string }> {
  n += 1;
  const whatsapp = `+2376706${String(n).padStart(5, '0')}`;
  const person = await prisma.person.create({ data: { name, whatsappNumber: whatsapp } });
  const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
  const ra = agentWithUniqueIp();
  const { csrf: rc } = await bootstrap(ra as any);
  await ra.post('/api/member/auth/request-link').set('X-CSRF-Token', rc).send({ whatsapp, email: `cert${n}@example.com` });
  const link = spy.mock.calls[spy.mock.calls.length - 1][0].link as string;
  spy.mockRestore();
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/member/auth/consume').set('X-CSRF-Token', csrf).send({ token: new URL(link).searchParams.get('token') });
  return { agent, csrf, id: person.id };
}

async function admin(): Promise<Who> {
  n += 1;
  const email = `cert-admin-${n}@test.local`;
  await createAdmin(email, 'AdminPass123!');
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'AdminPass123!' });
  return { agent, csrf };
}

const post = (w: Who, path: string, body: Record<string, unknown> = {}) => w.agent.post(path).set('X-CSRF-Token', w.csrf).send(body);
const patch = (w: Who, path: string, body: Record<string, unknown> = {}) => w.agent.patch(path).set('X-CSRF-Token', w.csrf).send(body);

// The programme's total is as many books as the test student has (2), unless a test says otherwise.
async function setProgrammeTotal(total: number) {
  await prisma.settings.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', trainingBooksTotal: total }, update: { trainingBooksTotal: total } });
}

beforeEach(async () => {
  state.passedAll = true;
  await setProgrammeTotal(2);
});
afterEach(() => vi.restoreAllMocks());

describe('Asking for the certificate (student)', () => {
  it('can be asked for in advance, before finishing: nothing is issued and the central admin is not bothered yet', async () => {
    state.passedAll = false;
    const m = await member('Nji Clinton');
    const info = await m.agent.get('/api/member/certificate');
    expect(info.body).toMatchObject({ eligible: false, passed: 1, total: 2, request: null, defaultName: 'Nji Clinton' });
    const res = await post(m, '/api/member/certificate', { name: 'Nji Clinton', delivery: 'EMAIL' });
    expect(res.status).toBe(201);
    expect(res.body.request.status).toBe('REQUESTED');
    expect(await prisma.notification.count({ where: { type: 'CERTIFICATE_REQUESTED' } })).toBe(0);
    expect((await m.agent.get('/api/member/certificate')).body).toMatchObject({ eligible: false, request: { status: 'REQUESTED' } });
  });

  it('tells students there are 16 books, even while only some are on the site, and needs all of them', async () => {
    await setProgrammeTotal(16); // the test student has 2 books on the site, both passed
    const m = await member('Sixteen');
    const info = await m.agent.get('/api/member/certificate');
    expect(info.body).toMatchObject({ eligible: false, passed: 2, total: 16 });
    await setProgrammeTotal(2);
    expect((await m.agent.get('/api/member/certificate')).body).toMatchObject({ eligible: true, passed: 2, total: 2 });
  });

  it('checks the name, and the address and phone that posting needs', async () => {
    const m = await member('Ada');
    expect((await post(m, '/api/member/certificate', { name: 'X', delivery: 'EMAIL' })).status).toBe(400);
    expect((await post(m, '/api/member/certificate', { name: 'Ada <b>', delivery: 'EMAIL' })).status).toBe(400);
    const noAddress = await post(m, '/api/member/certificate', { name: 'Ada Lovelace', delivery: 'POST', phone: '+237 670 00 00 01' });
    expect(noAddress.status).toBe(400);
    expect(noAddress.body.code).toBe('ADDRESS');
    const noPhone = await post(m, '/api/member/certificate', { name: 'Ada Lovelace', delivery: 'COLLECT' });
    expect(noPhone.body.code).toBe('PHONE');
  });

  it('records the request, tells the central admin, and shows the student no number, no note and no price', async () => {
    const a = await admin();
    const m = await member('Nji Clinton');
    const res = await post(m, '/api/member/certificate', { name: '  Nji   Clinton ', delivery: 'POST', language: 'en', phone: '+237 670 00 00 02', address: 'Rue 12, Akwa, Douala' });
    expect(res.status).toBe(201);
    expect(res.body.request).toMatchObject({ status: 'REQUESTED', nameOnCertificate: 'Nji Clinton', delivery: 'POST', certificateNumber: null, issuedAt: null });
    expect(JSON.stringify(res.body)).not.toMatch(/adminNote|price|FCFA/i);
    expect(await prisma.notification.count({ where: { type: 'CERTIFICATE_REQUESTED' } })).toBeGreaterThan(0);
    const again = await m.agent.get('/api/member/certificate');
    expect(again.body.request).toMatchObject({ status: 'REQUESTED', address: 'Rue 12, Akwa, Douala' });
    // While it is only a request, the student can fix it (no second notice).
    const before = await prisma.notification.count({ where: { type: 'CERTIFICATE_REQUESTED' } });
    const fix = await post(m, '/api/member/certificate', { name: 'Nji Clinton Jr', delivery: 'EMAIL' });
    expect(fix.status).toBe(200);
    expect(fix.body.request).toMatchObject({ nameOnCertificate: 'Nji Clinton Jr', delivery: 'EMAIL', address: null });
    expect(await prisma.notification.count({ where: { type: 'CERTIFICATE_REQUESTED' } })).toBe(before);
    void a;
  });
});

describe('The central admin handles requests', () => {
  it('lists requests with the private note, issues them with numbers in order, and tells the student', async () => {
    const a = await admin();
    const one = await member('First Student');
    const two = await member('Second Student');
    await post(one, '/api/member/certificate', { name: 'First Student', delivery: 'EMAIL' });
    await post(two, '/api/member/certificate', { name: 'Second Student', delivery: 'COLLECT', phone: '+237 670 00 00 03' });

    const list = await a.agent.get('/api/admin/certificates');
    expect(list.status).toBe(200);
    expect(list.body.open).toBe(2);
    const rowOne = list.body.items.find((i: any) => i.accountName === 'First Student');
    expect(rowOne).toMatchObject({ status: 'REQUESTED', delivery: 'EMAIL', email: expect.stringContaining('@example.com') });

    // The private note (the price agreed) is kept for the admin and never reaches the student.
    const noted = await patch(a, `/api/admin/certificates/${rowOne.id}`, { adminNote: 'Agreed 5 000 FCFA, paid by MTN' });
    expect(noted.body.item.adminNote).toBe('Agreed 5 000 FCFA, paid by MTN');
    expect(JSON.stringify((await one.agent.get('/api/member/certificate')).body)).not.toMatch(/5 000|Agreed/);

    // Spelling corrected by the admin before it is printed.
    await patch(a, `/api/admin/certificates/${rowOne.id}`, { nameOnCertificate: 'First  Studentt' });
    expect((await prisma.certificateRequest.findUnique({ where: { id: rowOne.id } }))!.nameOnCertificate).toBe('First Studentt');

    const paid = await post(a, `/api/admin/certificates/${rowOne.id}/paid`);
    expect(paid.body.item.status).toBe('PAID');
    const issued = await post(a, `/api/admin/certificates/${rowOne.id}/issue`);
    const year = new Date().getFullYear();
    expect(issued.body.item).toMatchObject({ status: 'ISSUED', certificateNumber: `GNLA-${year}-001` });
    const secondRow = list.body.items.find((i: any) => i.accountName === 'Second Student');
    // Issuing straight from "requested" also works, and counts on.
    const issuedTwo = await post(a, `/api/admin/certificates/${secondRow.id}/issue`);
    expect(issuedTwo.body.item.certificateNumber).toBe(`GNLA-${year}-002`);
    // Issuing twice changes nothing.
    expect((await post(a, `/api/admin/certificates/${rowOne.id}/issue`)).body.item.certificateNumber).toBe(`GNLA-${year}-001`);

    const mine = await one.agent.get('/api/member/certificate');
    expect(mine.body.request).toMatchObject({ status: 'ISSUED', certificateNumber: `GNLA-${year}-001`, nameOnCertificate: 'First Studentt' });
    expect(await prisma.notification.count({ where: { type: 'CERTIFICATE_ISSUED', recipientPersonId: one.id } })).toBe(1);

    // After it is issued the printed details are fixed and it cannot be cancelled or changed by the student.
    expect((await patch(a, `/api/admin/certificates/${rowOne.id}`, { nameOnCertificate: 'Other Name' })).status).toBe(409);
    expect((await post(a, `/api/admin/certificates/${rowOne.id}/cancel`)).status).toBe(409);
    expect((await post(one, '/api/member/certificate', { name: 'Other Name', delivery: 'EMAIL' })).status).toBe(409);

    const delivered = await post(a, `/api/admin/certificates/${rowOne.id}/delivered`);
    expect(delivered.body.item.status).toBe('DELIVERED');
    expect((await one.agent.get('/api/member/certificate')).body.request.deliveredAt).toBeTruthy();
  });

  it('cancels a request not yet issued, and lets the student ask again', async () => {
    const a = await admin();
    const m = await member('Changed Mind');
    await post(m, '/api/member/certificate', { name: 'Changed Mind', delivery: 'EMAIL' });
    const id = (await a.agent.get('/api/admin/certificates')).body.items[0].id;
    expect((await post(a, `/api/admin/certificates/${id}/cancel`)).body.item.status).toBe('CANCELLED');
    expect((await m.agent.get('/api/member/certificate')).body.request).toBeNull();
    expect((await post(m, '/api/member/certificate', { name: 'Changed Mind', delivery: 'EMAIL' })).status).toBe(200);
    expect((await m.agent.get('/api/member/certificate')).body.request.status).toBe('REQUESTED');
    // A cancelled request cannot be issued.
    await post(a, `/api/admin/certificates/${id}/cancel`);
    expect((await post(a, `/api/admin/certificates/${id}/issue`)).status).toBe(409);
  });

  it('shows how far each open request is, and will not issue before every book is passed unless the admin goes ahead', async () => {
    state.passedAll = false;
    const a = await admin();
    const m = await member('Early Bird');
    await post(m, '/api/member/certificate', { name: 'Early Bird', delivery: 'EMAIL' });
    const list = await a.agent.get('/api/admin/certificates');
    expect(list.body.items[0].progress).toEqual({ eligible: false, passed: 1, total: 2 });
    const id = list.body.items[0].id;
    const refused = await post(a, `/api/admin/certificates/${id}/issue`);
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'NOT_COMPLETE', error: 'This student has passed 1 of 2 books so far.' });
    expect((await prisma.certificateRequest.findUnique({ where: { id } }))!.status).toBe('REQUESTED');
    // Once they finish it goes through; or the admin may go ahead on purpose.
    state.passedAll = true;
    expect((await a.agent.get('/api/admin/certificates')).body.items[0].progress.eligible).toBe(true);
    state.passedAll = false;
    const forced = await post(a, `/api/admin/certificates/${id}/issue`, { override: true });
    expect(forced.status).toBe(200);
    expect(forced.body.item.status).toBe('ISSUED');
  });

  it('is for the central admin only', async () => {
    const m = await member('Curious');
    expect([401, 403]).toContain((await m.agent.get('/api/admin/certificates')).status);
    const anon = request(app);
    expect([401, 403]).toContain((await anon.get('/api/admin/certificates')).status);
  });
});
