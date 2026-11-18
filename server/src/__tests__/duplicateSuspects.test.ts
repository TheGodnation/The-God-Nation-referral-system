import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { bootstrap } from './testUtils';
import { dismissSuspect, emailKey, findDuplicateSuspects, gmailDotKey, nameKey, phoneKey } from '../lib/duplicateSuspects';

// "Possible duplicates": a suggestion list of accounts that may be one person; "Not the same person" hides a pair for good; and
// a second sign-up with the same Gmail inbox (dots moved) opens the existing account instead of making a new one.
const app = createApp();
let n = 0;
const rnd = () => Math.random().toString(36).slice(2, 8);

async function person(name: string, email: string, phone: string) {
  const p = await prisma.person.create({ data: { name, whatsappNumber: phone, profileCompletedAt: new Date() } });
  await prisma.memberAccount.create({ data: { personId: p.id, email } });
  return p;
}
const phoneOf = () => `+23767${String(++n + 5000000).padStart(7, '0')}`;

afterEach(() => vi.restoreAllMocks());

describe('the signs', () => {
  it('reads the inbox behind a Gmail address (dots and +tag ignored), the words of a name, and the last 8 digits of a phone', () => {
    expect(emailKey('John.Doe+church@Gmail.com')).toBe('johndoe@gmail.com');
    expect(emailKey('johndoe@googlemail.com')).toBe('johndoe@gmail.com');
    expect(emailKey('a.b@yahoo.com')).toBe('a.b@yahoo.com'); // dots count outside Gmail
    expect(emailKey('x@y.invalid')).toBeNull();
    expect(gmailDotKey('jo.hn@gmail.com')).toBe('john@gmail.com');
    expect(gmailDotKey('jo.hn@yahoo.com')).toBeNull();
    expect(nameKey('Ndoh  Stanley')).toBe(nameKey('stanley NDOH'));
    expect(nameKey('Élodie Mbarga')).toBe(nameKey('elodie mbarga'));
    expect(nameKey('Grace')).toBeNull(); // one word is too common to tell anything
    expect(nameKey('someone@example.com')).toBeNull(); // the placeholder name of a sign-up
    expect(phoneKey('+237 670 123 456')).toBe(phoneKey('00237670123456'));
    expect(phoneKey('12')).toBeNull();
  });
});

describe('finding and dismissing suspects', () => {
  it('pairs accounts by inbox, name or phone, says why, and never shows a dismissed pair again', async () => {
    const tag = rnd();
    const a = await person(`Zed${tag} Quill`, `zed.quill${tag}@gmail.com`, phoneOf());
    const b = await person(`Quill Zed${tag}`, `zedquill${tag}+2@gmail.com`, phoneOf());
    const c = await person(`Nobody${tag} Else`, `nobody${tag}@example.com`, phoneOf());

    const found = await findDuplicateSuspects();
    const pair = found.find((s) => [s.a.id, s.b.id].sort().join() === [a.id, b.id].sort().join());
    expect(pair).toBeTruthy();
    expect([...pair!.signs].sort()).toEqual(['email', 'name']);
    expect(pair!.a.joinedAt <= pair!.b.joinedAt).toBe(true); // older first
    expect(found.some((s) => s.a.id === c.id || s.b.id === c.id)).toBe(false);

    await dismissSuspect(b.id, a.id);
    expect((await findDuplicateSuspects()).some((s) => [s.a.id, s.b.id].includes(a.id) && [s.a.id, s.b.id].includes(b.id))).toBe(false);
  });
});

describe('a second sign-up with the same Gmail inbox', () => {
  it('sends the sign-in link to the existing account instead of creating a new one (dots moved); a +tag is still its own account', async () => {
    const tag = rnd();
    const first = await person(`Dot${tag} Owner`, `dot.owner${tag}@gmail.com`, phoneOf());
    const agent = request.agent(app);
    const { csrf } = await bootstrap(agent as any);
    const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });

    const res = await agent.post('/api/member/auth/signup').set('X-CSRF-Token', csrf).set('X-Forwarded-For', '10.77.1.1').send({ email: `dotowner${tag}@gmail.com`, whatsapp: phoneOf(), password: 'Testpass123', language: 'en', acceptTerms: true });
    expect(res.status).toBe(200);
    expect(spy.mock.calls[0]?.[0].to).toBe(`dot.owner${tag}@gmail.com`); // the existing account's own inbox
    expect(await prisma.memberAccount.count({ where: { email: `dotowner${tag}@gmail.com` } })).toBe(0);
    expect(await prisma.memberAccount.count({ where: { personId: first.id } })).toBe(1);

    // A "+tag" address is used on purpose (test accounts): it still makes its own account.
    const agent2 = request.agent(app);
    const { csrf: csrf2 } = await bootstrap(agent2 as any);
    const plus = await agent2.post('/api/member/auth/signup').set('X-CSRF-Token', csrf2).set('X-Forwarded-For', '10.77.1.2').send({ email: `dot.owner${tag}+test@gmail.com`, whatsapp: phoneOf(), password: 'Testpass123', language: 'en', acceptTerms: true });
    expect(plus.status).toBe(200);
    expect(await prisma.memberAccount.count({ where: { email: `dot.owner${tag}+test@gmail.com` } })).toBe(1);
  });
});
