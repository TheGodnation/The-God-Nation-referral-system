import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { bootstrap } from './testUtils';
import { resetGoogleKeysForTests, verifyGoogleIdToken } from '../lib/googleSignIn';

// "Continue with Google": an existing member signs in with the Google account whose confirmed email is on their member account.
const app = createApp();
const CLIENT_ID = 'test-client-123.apps.googleusercontent.com';
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'key-1', alg: 'RS256', use: 'sig' };
const { privateKey: otherKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

const b64 = (o: unknown) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
function token(claims: Record<string, unknown> = {}, opts: { key?: crypto.KeyObject; kid?: string } = {}) {
  const header = b64({ alg: 'RS256', kid: opts.kid ?? 'key-1', typ: 'JWT' });
  const payload = b64({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: 'g-1', email: 'x@example.com', email_verified: true, name: 'Good Person', exp: Math.floor(Date.now() / 1000) + 3600, ...claims });
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), opts.key ?? privateKey).toString('base64url');
  return `${header}.${payload}.${sig}`;
}

let n = 0;
function agent() {
  n += 1;
  const raw = request.agent(app);
  const ip = `10.211.${Math.floor(n / 256) % 256}.${n % 256}`;
  return { get: (p: string) => raw.get(p).set('X-Forwarded-For', ip), post: (p: string) => raw.post(p).set('X-Forwarded-For', ip), raw };
}
async function member(email: string, name = 'Google Member') {
  n += 1;
  const person = await prisma.person.create({ data: { name, whatsappNumber: `+2379100${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() } });
  await prisma.memberAccount.create({ data: { personId: person.id, email } });
  return person;
}

beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
  resetGoogleKeysForTests();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).includes('googleapis.com/oauth2/v3/certs') ? { ok: true, status: 200, headers: { get: () => 'public, max-age=3600' }, json: async () => ({ keys: [jwk] }) } : { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) })));
});
afterEach(() => {
  delete process.env.GOOGLE_CLIENT_ID;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function signIn(credential: string) {
  const a = agent();
  const { csrf } = await bootstrap(a as any);
  const res = await a.post('/api/member/auth/google').set('X-CSRF-Token', csrf).send({ credential });
  return { res, a, csrf };
}

describe('checking a Google ID token', () => {
  it('accepts a good one and reads the confirmed email', async () => {
    expect(await verifyGoogleIdToken(token({ email: 'Mary@Example.com' }))).toEqual({ email: 'mary@example.com', name: 'Good Person', sub: 'g-1' });
  });
  it('refuses a token that is forged, for another app, expired, from another issuer, or with an unconfirmed email', async () => {
    expect(await verifyGoogleIdToken(token({}, { key: otherKey }))).toBeNull(); // not signed by Google
    expect(await verifyGoogleIdToken(token({ aud: 'someone-else' }))).toBeNull();
    expect(await verifyGoogleIdToken(token({ exp: Math.floor(Date.now() / 1000) - 10 }))).toBeNull();
    expect(await verifyGoogleIdToken(token({ iss: 'https://evil.example.com' }))).toBeNull();
    expect(await verifyGoogleIdToken(token({ email_verified: false }))).toBeNull();
    expect(await verifyGoogleIdToken(token({}, { kid: 'unknown-key' }))).toBeNull();
    expect(await verifyGoogleIdToken('not.a.token')).toBeNull();
    expect(await verifyGoogleIdToken('garbage')).toBeNull();
  });
  it('is off while no Client ID is set', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    expect(await verifyGoogleIdToken(token())).toBeNull();
  });
});

describe('Continue with Google', () => {
  it('tells the app whether it is set up, and only gives the public Client ID', async () => {
    const a = agent();
    expect((await a.get('/api/member/auth/google-config')).body).toEqual({ clientId: CLIENT_ID });
    delete process.env.GOOGLE_CLIENT_ID;
    expect((await a.get('/api/member/auth/google-config')).body).toEqual({ clientId: null });
  });

  it('signs in the member whose email Google confirmed, with no code and no password', async () => {
    const p = await member(`goo${++n}@example.com`);
    const account = await prisma.memberAccount.findUniqueOrThrow({ where: { personId: p.id } });
    const { res, a } = await signIn(token({ email: account.email }));
    expect(res.status).toBe(200);
    expect(res.body.member).toMatchObject({ email: account.email, name: 'Google Member' });
    expect((await a.get('/api/member/auth/me')).body.member).toMatchObject({ name: 'Google Member' }); // the session works
    expect((await prisma.memberAccount.findUniqueOrThrow({ where: { id: account.id } })).lastLoginAt).not.toBeNull();
  });

  it('matches a Gmail address written with the dots in other places', async () => {
    const k = ++n;
    const p = await member(`john.doe${k}@gmail.com`);
    const { res } = await signIn(token({ email: `johndoe${k}@gmail.com` }));
    expect(res.status).toBe(200);
    expect(res.body.member.name).toBe('Google Member');
    expect(p.id).toBeTruthy();
  });

  it('creates nobody: an email with no member account is told to join first', async () => {
    const before = await prisma.memberAccount.count();
    const { res } = await signIn(token({ email: `nobody${++n}@example.com` }));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NO_ACCOUNT');
    expect(await prisma.memberAccount.count()).toBe(before);
  });

  it('refuses a bad token and does nothing when Google sign-in is not set up', async () => {
    const p = await member(`goo${++n}@example.com`);
    const account = await prisma.memberAccount.findUniqueOrThrow({ where: { personId: p.id } });
    expect((await signIn(token({ email: account.email }, { key: otherKey }))).res.status).toBe(401);
    delete process.env.GOOGLE_CLIENT_ID;
    expect((await signIn(token({ email: account.email }))).res.status).toBe(404);
  });

  it('keeps the central admin’s profile behind the emailed code on a phone it has not used before', async () => {
    const p = await member(`boss${++n}@example.com`, 'Central Admin');
    await prisma.user.create({ data: { name: 'Central Admin', email: `boss-admin-${n}@test.local`, passwordHash: 'x', role: 'ADMIN', personId: p.id } });
    const account = await prisma.memberAccount.findUniqueOrThrow({ where: { personId: p.id } });
    const mail = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
    const { res, a } = await signIn(token({ email: account.email }));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ codeRequired: true });
    expect(res.body.member).toBeUndefined();
    expect(mail).toHaveBeenCalled();
    expect((await a.get('/api/member/auth/me')).body.member).toBeNull(); // no session yet
  });
});
