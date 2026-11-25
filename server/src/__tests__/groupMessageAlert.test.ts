import crypto from 'crypto';
import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';

vi.mock('../lib/storage', () => ({
  isStorageConfigured: vi.fn(() => true),
  createUploadUrl: vi.fn(async ({ storageKey }: { storageKey: string }) => ({ url: `https://mock-r2.example/upload/${storageKey}`, expiresAt: new Date(Date.now() + 5 * 60 * 1000) })),
  createDownloadUrl: vi.fn(async ({ storageKey }: { storageKey: string }) => ({ url: `https://mock-r2.example/download/${storageKey}`, expiresAt: new Date(Date.now() + 5 * 60 * 1000) })),
  headObject: vi.fn(async () => null),
}));
// The phone alerts that go out are captured: who they go to and what they say.
const alerts: { to: string[]; payload: any }[] = [];
vi.mock('../lib/push', async (importActual) => ({
  ...(await importActual<typeof import('../lib/push')>()),
  pushToPersons: vi.fn(async (to: string[], payload: unknown) => {
    alerts.push({ to, payload });
  }),
}));

import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import * as storage from '../lib/storage';
import { bootstrap } from './testUtils';

// The ordinary alert for a message in a group or assembly: every other active member's phone is told, whoever sends it (a member,
// or the central admin), and for a text, a voice note or a photo alike.
const app = createApp();
let n = 0;
let ipCounter = 0;
afterEach(() => {
  alerts.length = 0;
});

async function person(name: string) {
  n += 1;
  return prisma.person.create({ data: { name: `${name} ${n}`, whatsappNumber: `+2377500${String(n).padStart(5, '0')}`, profileCompletedAt: new Date(), preferredLanguage: 'en' } });
}
async function group(memberIds: string[], opts: { removed?: string[] } = {}) {
  n += 1;
  const g = await prisma.community.create({ data: { name: `Assembly Alert ${n}` } });
  for (const personId of memberIds) await prisma.communityMembership.create({ data: { personId, communityId: g.id, status: 'ACTIVE' } });
  for (const personId of opts.removed ?? []) await prisma.communityMembership.create({ data: { personId, communityId: g.id, status: 'INACTIVE' } });
  return g;
}
async function signedIn(personId: string, email: string, admin = false) {
  ipCounter += 1;
  const ip = `10.151.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
  await prisma.memberAccount.create({ data: { personId, email } });
  if (admin) await prisma.user.create({ data: { name: 'Central Admin', email: `alert-admin-${n}@test.local`, passwordHash: 'x', role: 'ADMIN', personId } });
  const raw = request.agent(app);
  const { csrf } = await bootstrap(raw as any);
  const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
  await raw.post('/api/member/auth/request-code').set('X-Forwarded-For', ip).set('X-CSRF-Token', csrf).send({ email });
  const code = spy.mock.calls[0][0].code as string;
  spy.mockRestore();
  await raw.post('/api/member/auth/verify-code').set('X-Forwarded-For', ip).set('X-CSRF-Token', csrf).send({ email, code });
  return { post: (path: string, body: object) => raw.post(path).set('X-Forwarded-For', ip).set('X-CSRF-Token', csrf).send(body) };
}
const settle = () => new Promise((r) => setTimeout(r, 300));
const voice = (communityId: string) => ({ storageKey: `communities/${communityId}/attachments/${crypto.randomUUID()}`, originalFilename: 'voice-note.m4a', mimeType: 'audio/mp4', byteSize: 48_000, durationMs: 9_000 });

describe('Phone alert for a message in a group or assembly', () => {
  it('tells every other active member when a member writes, and not the writer or someone who was removed', async () => {
    const writer = await person('Writer');
    const a = await person('Alpha');
    const b = await person('Beta');
    const gone = await person('Gone');
    const g = await group([writer.id, a.id, b.id], { removed: [gone.id] });
    const w = await signedIn(writer.id, `alert-writer-${n}@example.com`);
    expect((await w.post(`/api/communities/${g.id}/conversation/messages`, { body: 'Good morning family' })).status).toBe(201);
    await settle();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].to.sort()).toEqual([a.id, b.id].sort());
    expect(alerts[0].payload.title).toContain(writer.name);
    expect(alerts[0].payload.body).toBe('Good morning family');
    expect(alerts[0].payload.url).toBe(`/member/chats/group/${g.id}`);
  });

  it('does the same when the central admin writes, and for a voice note that is not part of a teaching', async () => {
    const admin = await person('Admin');
    const a = await person('Alpha');
    const b = await person('Beta');
    const g = await group([admin.id, a.id, b.id]);
    const ad = await signedIn(admin.id, `alert-admin-${n}@example.com`, true);
    vi.mocked(storage.headObject).mockResolvedValue({ contentLength: 48_000, contentType: 'audio/mp4' } as any);
    expect((await ad.post(`/api/communities/${g.id}/conversation/messages`, { body: 'Welcome everyone' })).status).toBe(201);
    await settle();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].to.sort()).toEqual([a.id, b.id].sort());
    expect((await ad.post(`/api/communities/${g.id}/conversation/messages`, { attachments: [voice(g.id)] })).status).toBe(201);
    await settle();
    expect(alerts).toHaveLength(2);
    expect(alerts[1].to.sort()).toEqual([a.id, b.id].sort());
    expect(alerts[1].payload.body).toContain('Voice message');
    vi.mocked(storage.headObject).mockResolvedValue(null);
  });
});
