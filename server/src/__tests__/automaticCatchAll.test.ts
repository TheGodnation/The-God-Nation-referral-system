import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createAdmin } from './helpers';
import { bootstrap } from './testUtils';
import { joinAsNewMember } from './joinHelper';

// Someone who joins with nobody's link becomes a friend of the central admin's own member profile
// automatically — nothing to set in Settings (a person chosen there still wins).
const app = createApp();
let ipCounter = 0;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.123.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', ip);
  return wrapped;
}
let phoneCounter = 0;
const fresh = () => `+237673${String(500000 + ++phoneCounter).padStart(6, '0')}`;
const DETAILS = { name: 'Jean Ngono', country: 'Cameroon', region: 'Centre', division: 'Mfoundi', subdivision: 'Yaoundé III', quarter: 'Efoulan' };

async function centralAdminProfile(isTestData = false) {
  const person = await prisma.person.create({ data: { name: 'Central Admin', whatsappNumber: fresh(), isTestData } });
  await createAdmin('central-auto@test.local', 'AdminPass123!');
  await prisma.user.update({ where: { email: 'central-auto@test.local' }, data: { personId: person.id } });
  return person;
}

afterEach(() => vi.restoreAllMocks());

describe('Automatic catch-all', () => {
  it("friends and attributes a link-less joiner to the central admin's member profile, even if that profile is flagged as test data", async () => {
    await prisma.settings.upsert({ where: { id: 'singleton' }, update: { defaultReferrerPersonId: null }, create: { id: 'singleton' } });
    const admin = await centralAdminProfile(true);
    const agent = agentWithUniqueIp();
    const { csrf } = await bootstrap(agent as any);
    const whatsapp = fresh();
    const res = (await joinAsNewMember(agent, csrf, { email: 'auto-catch@example.com', whatsapp, details: DETAILS })).done;
    expect(res.status).toBe(200);

    const person = await prisma.person.findUnique({ where: { whatsappNumber: whatsapp } });
    const registration = await prisma.registration.findUnique({ where: { normalizedWhatsApp: whatsapp } });
    expect(registration?.referredByPersonId).toBe(admin.id);
    const friendship = await prisma.friendship.findFirst({ where: { requesterPersonId: admin.id, addresseePersonId: person!.id } });
    expect(friendship?.origin).toBe('REFERRAL');
    expect(friendship?.status).toBe('ACCEPTED');
  });

  it('a person chosen in Settings wins over the automatic one', async () => {
    await centralAdminProfile();
    const chosen = await prisma.person.create({ data: { name: 'Chosen One', whatsappNumber: fresh() } });
    await prisma.settings.upsert({ where: { id: 'singleton' }, update: { defaultReferrerPersonId: chosen.id }, create: { id: 'singleton', defaultReferrerPersonId: chosen.id } });
    const agent = agentWithUniqueIp();
    const { csrf } = await bootstrap(agent as any);
    const whatsapp = fresh();
    expect((await joinAsNewMember(agent, csrf, { email: 'chosen-catch@example.com', whatsapp, details: DETAILS })).done.status).toBe(200);
    const registration = await prisma.registration.findUnique({ where: { normalizedWhatsApp: whatsapp } });
    expect(registration?.referredByPersonId).toBe(chosen.id);
    await prisma.settings.update({ where: { id: 'singleton' }, data: { defaultReferrerPersonId: null } });
  });

  it('Settings tells the admin who catches joiners and that it is automatic', async () => {
    await prisma.settings.upsert({ where: { id: 'singleton' }, update: { defaultReferrerPersonId: null }, create: { id: 'singleton' } });
    const admin = await centralAdminProfile();
    const agent = agentWithUniqueIp();
    const { csrf } = await bootstrap(agent as any);
    const login = await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: 'central-auto@test.local', password: 'AdminPass123!' });
    expect(login.status).toBe(200);
    const res = await agent.get('/api/admin/settings');
    expect(res.body.catchAll).toEqual({ id: admin.id, name: 'Central Admin', automatic: true });
  });
});
