import crypto from 'crypto';
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { createLeader, createAdmin } from './helpers';
import { bootstrap } from './testUtils';

// Media Phase 1 — Headquarters Post Media. Mirrors the exact conventions
// established in headquartersPosts.test.ts (agentWithUniqueIp,
// loginAsAdmin/setupLeader/loginAsMember, makeCommunity/joinCommunity,
// publishTargeted/publishNetworkWide) and communityConversations.test.ts's
// own attachment-lifecycle mocking of lib/storage.ts (no real R2
// credentials exist in this test environment, by design — every test below
// exercises the real authorization/validation/finalize logic while treating
// "does R2 actually store the bytes" as already covered by the AWS SDK).
vi.mock('../lib/storage', () => ({
  isStorageConfigured: vi.fn(() => true),
  createUploadUrl: vi.fn(async ({ storageKey }: { storageKey: string }) => ({
    url: `https://mock-r2.example/upload/${storageKey}`,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  })),
  createDownloadUrl: vi.fn(async ({ storageKey }: { storageKey: string }) => ({
    url: `https://mock-r2.example/download/${storageKey}`,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  })),
  headObject: vi.fn(async () => null),
}));
import * as storage from '../lib/storage';

function mediaStorageKey(headquartersPostId: string): string {
  return `headquarters-posts/${headquartersPostId}/media/${crypto.randomUUID()}`;
}

function mockHeadMatches(descriptor: { byteSize: number; mimeType: string }) {
  vi.mocked(storage.headObject).mockResolvedValueOnce({ contentLength: descriptor.byteSize, contentType: descriptor.mimeType });
}

const app = createApp();

let ipCounter = 20000;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.199.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) {
    wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', ip);
  }
  return wrapped;
}

function extractToken(link: string): string {
  return new URL(link).searchParams.get('token')!;
}

async function loginAsAdmin(n: number) {
  const email = `hqm-admin${n}@test.local`;
  await createAdmin(email);
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'AdminPass123!' });
  return { agent, csrf, email };
}

async function setupLeader(n: number) {
  const email = `hqm-leader${n}@test.local`;
  const { user } = await createLeader(`HQ Media Leader ${n}`, email, `HQM${n}CODE`);
  const person = await prisma.person.create({
    data: { name: `HQ Media Leader Person ${n}`, whatsappNumber: `+237698${String(n).padStart(6, '0')}` },
  });
  await prisma.user.update({ where: { id: user.id }, data: { personId: person.id } });

  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'password123' });
  return { agent, csrf, user, person };
}

async function loginAsMember(whatsapp: string, email: string, name = 'HQ Media Member') {
  const person = await prisma.person.create({ data: { name, whatsappNumber: whatsapp } });
  const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
  const requestAgent = agentWithUniqueIp();
  const { csrf: requestCsrf } = await bootstrap(requestAgent as any);
  await requestAgent.post('/api/member/auth/request-link').set('X-CSRF-Token', requestCsrf).send({ whatsapp, email });
  const link = spy.mock.calls[spy.mock.calls.length - 1][0].link as string;
  spy.mockRestore();
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/member/auth/consume').set('X-CSRF-Token', csrf).send({ token: extractToken(link) });
  return { agent, csrf, person };
}

async function makeCommunity(name: string) {
  return prisma.community.create({ data: { name } });
}

async function joinCommunity(personId: string, communityId: string) {
  return prisma.communityMembership.create({ data: { personId, communityId, status: 'ACTIVE' } });
}

async function createDraftPost(adminAgent: any, csrf: string, titleEn: string) {
  const res = await adminAgent.post('/api/admin/headquarters-posts').set('X-CSRF-Token', csrf).send({ titleEn, bodyEn: 'Body.' });
  return res.body.id as string;
}

async function finalizeMedia(
  adminAgent: any,
  csrf: string,
  postId: string,
  descriptor: { originalFilename: string; mimeType: string; byteSize: number },
) {
  const storageKey = mediaStorageKey(postId);
  mockHeadMatches(descriptor);
  return adminAgent
    .post(`/api/admin/headquarters-posts/${postId}/media`)
    .set('X-CSRF-Token', csrf)
    .send({ storageKey, ...descriptor });
}

async function publishTargeted(adminAgent: any, csrf: string, postId: string, communityIds: string[]) {
  await adminAgent.patch(`/api/admin/headquarters-posts/${postId}`).set('X-CSRF-Token', csrf).send({ targetCommunityIds: communityIds });
  return adminAgent.post(`/api/admin/headquarters-posts/${postId}/publish`).set('X-CSRF-Token', csrf);
}

const IMAGE = { originalFilename: 'photo.png', mimeType: 'image/png', byteSize: 1024 };
const VIDEO = { originalFilename: 'clip.mp4', mimeType: 'video/mp4', byteSize: 2048 };
const AUDIO = { originalFilename: 'sermon.mp3', mimeType: 'audio/mpeg', byteSize: 4096 };
const PDF = { originalFilename: 'handout.pdf', mimeType: 'application/pdf', byteSize: 8192 };

describe('Headquarters Post Media — authorize upload', () => {
  it('an Admin can authorize a media upload for a draft post', async () => {
    const { agent, csrf } = await loginAsAdmin(1);
    const postId = await createDraftPost(agent, csrf, 'Media Authorize A');

    const res = await agent
      .post(`/api/admin/headquarters-posts/${postId}/media/authorize`)
      .set('X-CSRF-Token', csrf)
      .send(IMAGE);
    expect(res.status).toBe(200);
    expect(res.body.storageKey).toMatch(new RegExp(`^headquarters-posts/${postId}/media/[0-9a-f-]{36}$`));
    expect(res.body.uploadUrl).toContain(res.body.storageKey);
    expect(res.body.maxBytes).toBe(8 * 1024 * 1024);
  });

  it('a Leader cannot authorize a media upload', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(2);
    const postId = await createDraftPost(adminAgent, csrf, 'Media Authorize B');
    const { agent: leaderAgent, csrf: leaderCsrf } = await setupLeader(1);

    const res = await leaderAgent
      .post(`/api/admin/headquarters-posts/${postId}/media/authorize`)
      .set('X-CSRF-Token', leaderCsrf)
      .send(IMAGE);
    expect(res.status).toBe(403);
  });

  it('an unauthenticated caller cannot authorize a media upload', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(3);
    const postId = await createDraftPost(adminAgent, csrf, 'Media Authorize C');
    const anon = agentWithUniqueIp();

    const res = await anon.post(`/api/admin/headquarters-posts/${postId}/media/authorize`).send(IMAGE);
    expect(res.status).toBe(401);
  });

  it('CSRF protection is enforced on authorize', async () => {
    const { agent, csrf } = await loginAsAdmin(4);
    const postId = await createDraftPost(agent, csrf, 'Media Authorize D');

    const res = await agent.post(`/api/admin/headquarters-posts/${postId}/media/authorize`).send(IMAGE);
    expect(res.status).toBe(403);
  });

  it('an unsupported MIME type is rejected at authorize time', async () => {
    const { agent, csrf } = await loginAsAdmin(5);
    const postId = await createDraftPost(agent, csrf, 'Media Authorize E');

    const res = await agent
      .post(`/api/admin/headquarters-posts/${postId}/media/authorize`)
      .set('X-CSRF-Token', csrf)
      .send({ originalFilename: 'script.exe', mimeType: 'application/x-msdownload', byteSize: 1024 });
    expect(res.status).toBe(400);
  });

  it('an oversized file is rejected at authorize time according to the existing policy', async () => {
    const { agent, csrf } = await loginAsAdmin(6);
    const postId = await createDraftPost(agent, csrf, 'Media Authorize F');

    const res = await agent
      .post(`/api/admin/headquarters-posts/${postId}/media/authorize`)
      .set('X-CSRF-Token', csrf)
      .send({ originalFilename: 'photo.png', mimeType: 'image/png', byteSize: 9 * 1024 * 1024 });
    expect(res.status).toBe(400);
  });

  it('authorize is rejected once the post is published', async () => {
    const { agent, csrf } = await loginAsAdmin(7);
    const community = await makeCommunity('Media Authorize Published Community');
    const postId = await createDraftPost(agent, csrf, 'Media Authorize G');
    await publishTargeted(agent, csrf, postId, [community.id]);

    const res = await agent
      .post(`/api/admin/headquarters-posts/${postId}/media/authorize`)
      .set('X-CSRF-Token', csrf)
      .send(IMAGE);
    expect(res.status).toBe(409);
  });
});

describe('Headquarters Post Media — finalize', () => {
  it('finalization associates the media with the correct headquarters post', async () => {
    const { agent, csrf } = await loginAsAdmin(8);
    const postId = await createDraftPost(agent, csrf, 'Finalize A');

    const res = await finalizeMedia(agent, csrf, postId, IMAGE);
    expect(res.status).toBe(201);
    expect(res.body.media).toMatchObject({ originalFilename: IMAGE.originalFilename, mimeType: IMAGE.mimeType, byteSize: IMAGE.byteSize, mediaType: 'IMAGE' });

    const stored = await prisma.headquartersPostMedia.findUnique({ where: { headquartersPostId: postId } });
    expect(stored).not.toBeNull();
    expect(stored!.headquartersPostId).toBe(postId);
  });

  it('a Leader cannot finalize media', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(9);
    const postId = await createDraftPost(adminAgent, csrf, 'Finalize B');
    const { agent: leaderAgent, csrf: leaderCsrf } = await setupLeader(2);

    const storageKey = mediaStorageKey(postId);
    const res = await leaderAgent
      .post(`/api/admin/headquarters-posts/${postId}/media`)
      .set('X-CSRF-Token', leaderCsrf)
      .send({ storageKey, ...IMAGE });
    expect(res.status).toBe(403);
  });

  it('CSRF protection is enforced on finalize', async () => {
    const { agent, csrf } = await loginAsAdmin(10);
    const postId = await createDraftPost(agent, csrf, 'Finalize C');
    const storageKey = mediaStorageKey(postId);

    const res = await agent.post(`/api/admin/headquarters-posts/${postId}/media`).send({ storageKey, ...IMAGE });
    expect(res.status).toBe(403);
  });

  it('a storage key belonging to a different post is rejected', async () => {
    const { agent, csrf } = await loginAsAdmin(11);
    const postIdA = await createDraftPost(agent, csrf, 'Finalize D - A');
    const postIdB = await createDraftPost(agent, csrf, 'Finalize D - B');
    const foreignStorageKey = mediaStorageKey(postIdB);

    // No mockHeadMatches here: the route rejects on the storage-key/post
    // ownership mismatch before ever calling headObject, so queuing a
    // headObject return value here would never be consumed by this
    // request — it would instead leak into and corrupt a later test's own
    // headObject call.
    const res = await agent
      .post(`/api/admin/headquarters-posts/${postIdA}/media`)
      .set('X-CSRF-Token', csrf)
      .send({ storageKey: foreignStorageKey, ...IMAGE });
    expect(res.status).toBe(400);
  });

  it('an unsupported MIME type is rejected at finalize time', async () => {
    const { agent, csrf } = await loginAsAdmin(12);
    const postId = await createDraftPost(agent, csrf, 'Finalize E');
    const storageKey = mediaStorageKey(postId);

    const res = await agent
      .post(`/api/admin/headquarters-posts/${postId}/media`)
      .set('X-CSRF-Token', csrf)
      .send({ storageKey, originalFilename: 'script.exe', mimeType: 'application/x-msdownload', byteSize: 1024 });
    expect(res.status).toBe(400);
  });

  it('an oversized file is rejected at finalize time according to the existing policy', async () => {
    const { agent, csrf } = await loginAsAdmin(13);
    const postId = await createDraftPost(agent, csrf, 'Finalize F');
    const storageKey = mediaStorageKey(postId);

    const res = await agent
      .post(`/api/admin/headquarters-posts/${postId}/media`)
      .set('X-CSRF-Token', csrf)
      .send({ storageKey, originalFilename: 'photo.png', mimeType: 'image/png', byteSize: 9 * 1024 * 1024 });
    expect(res.status).toBe(400);
  });

  it('finalize is rejected when the uploaded object cannot be verified in R2', async () => {
    const { agent, csrf } = await loginAsAdmin(14);
    const postId = await createDraftPost(agent, csrf, 'Finalize G');
    const storageKey = mediaStorageKey(postId);
    // headObject default mock resolves to null (object not found in R2).

    const res = await agent
      .post(`/api/admin/headquarters-posts/${postId}/media`)
      .set('X-CSRF-Token', csrf)
      .send({ storageKey, ...IMAGE });
    expect(res.status).toBe(400);

    const stored = await prisma.headquartersPostMedia.findUnique({ where: { headquartersPostId: postId } });
    expect(stored).toBeNull();
  });

  it('finalize is rejected once the post is published', async () => {
    const { agent, csrf } = await loginAsAdmin(15);
    const community = await makeCommunity('Finalize Published Community');
    const postId = await createDraftPost(agent, csrf, 'Finalize H');
    await publishTargeted(agent, csrf, postId, [community.id]);
    const storageKey = mediaStorageKey(postId);

    // No mockHeadMatches: the route rejects on the already-published check
    // before ever calling headObject (see the comment on the previous test).
    const res = await agent
      .post(`/api/admin/headquarters-posts/${postId}/media`)
      .set('X-CSRF-Token', csrf)
      .send({ storageKey, ...IMAGE });
    expect(res.status).toBe(409);
  });

  it('finalize is rejected once the post is archived', async () => {
    const { agent, csrf } = await loginAsAdmin(16);
    const postId = await createDraftPost(agent, csrf, 'Finalize I');
    await agent.post(`/api/admin/headquarters-posts/${postId}/archive`).set('X-CSRF-Token', csrf);
    const storageKey = mediaStorageKey(postId);

    // No mockHeadMatches: rejected on the already-archived check first.
    const res = await agent
      .post(`/api/admin/headquarters-posts/${postId}/media`)
      .set('X-CSRF-Token', csrf)
      .send({ storageKey, ...IMAGE });
    expect(res.status).toBe(409);
  });

  it('finalizing again on the same draft replaces the previous media (at most one per post)', async () => {
    const { agent, csrf } = await loginAsAdmin(17);
    const postId = await createDraftPost(agent, csrf, 'Finalize J');

    await finalizeMedia(agent, csrf, postId, IMAGE);
    const second = await finalizeMedia(agent, csrf, postId, PDF);
    expect(second.status).toBe(201);
    expect(second.body.media.mediaType).toBe('PDF');

    const count = await prisma.headquartersPostMedia.count({ where: { headquartersPostId: postId } });
    expect(count).toBe(1);
  });

  it('records an audit log entry for a successful finalize', async () => {
    const { agent, csrf } = await loginAsAdmin(18);
    const postId = await createDraftPost(agent, csrf, 'Finalize K');

    const before = await prisma.auditLog.count({ where: { action: 'HEADQUARTERS_POST_MEDIA_ATTACHED' } });
    await finalizeMedia(agent, csrf, postId, IMAGE);
    const after = await prisma.auditLog.count({ where: { action: 'HEADQUARTERS_POST_MEDIA_ATTACHED' } });
    expect(after).toBe(before + 1);
  });
});

describe('Headquarters Post Media — recipient download authorization', () => {
  it('an unauthorized (ineligible) recipient cannot obtain the media download URL', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(19);
    const community = await makeCommunity('Media Unauthorized Community');
    const postId = await createDraftPost(adminAgent, csrf, 'Unauthorized Media Post');
    await finalizeMedia(adminAgent, csrf, postId, IMAGE);
    await publishTargeted(adminAgent, csrf, postId, [community.id]);

    const { agent: memberAgent } = await loginAsMember('+237699100001', 'hqm-member1@example.com');
    const res = await memberAgent.get(`/api/me/headquarters-posts/${postId}/media/download-url`);
    expect(res.status).toBe(404);
  });

  it('an authorized recipient can obtain a short-lived download URL', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(20);
    const community = await makeCommunity('Media Authorized Community');
    const { agent: memberAgent, person } = await loginAsMember('+237699100002', 'hqm-member2@example.com');
    await joinCommunity(person.id, community.id);

    const postId = await createDraftPost(adminAgent, csrf, 'Authorized Media Post');
    await finalizeMedia(adminAgent, csrf, postId, IMAGE);
    await publishTargeted(adminAgent, csrf, postId, [community.id]);

    const res = await memberAgent.get(`/api/me/headquarters-posts/${postId}/media/download-url`);
    expect(res.status).toBe(200);
    expect(res.body.url).toContain('mock-r2.example/download/');
    expect(res.body.expiresAt).toBeTruthy();
    expect(res.body.mediaType).toBe('IMAGE');
  });

  it('media belonging to another headquarters post cannot be accessed through a different post id', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(21);
    const communityA = await makeCommunity('Media Cross-Post Community A');
    const communityB = await makeCommunity('Media Cross-Post Community B');
    const { agent: memberAgent, person } = await loginAsMember('+237699100003', 'hqm-member3@example.com');
    await joinCommunity(person.id, communityB.id);

    const postIdA = await createDraftPost(adminAgent, csrf, 'Cross-Post A');
    await finalizeMedia(adminAgent, csrf, postIdA, IMAGE);
    await publishTargeted(adminAgent, csrf, postIdA, [communityA.id]);

    const postIdB = await createDraftPost(adminAgent, csrf, 'Cross-Post B');
    await publishTargeted(adminAgent, csrf, postIdB, [communityB.id]);

    // The member qualifies for post B (no media) but not post A (has media)
    // — requesting A's media via A's own id must 404 for this member, and B
    // has no media of its own to leak either way.
    const resA = await memberAgent.get(`/api/me/headquarters-posts/${postIdA}/media/download-url`);
    expect(resA.status).toBe(404);
    const resB = await memberAgent.get(`/api/me/headquarters-posts/${postIdB}/media/download-url`);
    expect(resB.status).toBe(404);
  });

  it('a post with no media returns 404 for an otherwise-eligible recipient', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(22);
    const community = await makeCommunity('Media None Community');
    const { agent: memberAgent, person } = await loginAsMember('+237699100004', 'hqm-member4@example.com');
    await joinCommunity(person.id, community.id);

    const postId = await createDraftPost(adminAgent, csrf, 'No Media Post');
    await publishTargeted(adminAgent, csrf, postId, [community.id]);

    const res = await memberAgent.get(`/api/me/headquarters-posts/${postId}/media/download-url`);
    expect(res.status).toBe(404);
  });

  it('an unauthenticated caller cannot obtain a download URL', async () => {
    const anon = agentWithUniqueIp();
    const res = await anon.get('/api/me/headquarters-posts/00000000-0000-0000-0000-000000000000/media/download-url');
    expect(res.status).toBe(401);
  });

  it('a Leader qualifies for media under the exact same audience rules as a Member', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(23);
    const community = await makeCommunity('Media Leader Community');
    const { agent: leaderAgent, person: leaderPerson } = await setupLeader(3);
    await joinCommunity(leaderPerson.id, community.id);

    const postId = await createDraftPost(adminAgent, csrf, 'Leader Media Post');
    await finalizeMedia(adminAgent, csrf, postId, IMAGE);
    await publishTargeted(adminAgent, csrf, postId, [community.id]);

    const res = await leaderAgent.get(`/api/me/headquarters-posts/${postId}/media/download-url`);
    expect(res.status).toBe(200);
  });

  it('an Admin session cannot use the recipient media endpoint as a bypass', async () => {
    const { agent, csrf } = await loginAsAdmin(24);
    const community = await makeCommunity('Media Admin Bypass Community');
    const postId = await createDraftPost(agent, csrf, 'Admin Bypass Post');
    await finalizeMedia(agent, csrf, postId, IMAGE);
    await publishTargeted(agent, csrf, postId, [community.id]);

    const res = await agent.get(`/api/me/headquarters-posts/${postId}/media/download-url`);
    expect(res.status).toBe(401);
  });

  it('network-wide eligibility also governs media access (no separate bypass path)', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(25);
    const hq = await makeCommunity('Media Network Wide HQ');
    await prisma.settings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', headquartersCommunityId: hq.id },
      update: { headquartersCommunityId: hq.id },
    });
    const { agent: memberAgent, person } = await loginAsMember('+237699100005', 'hqm-member5@example.com');
    await joinCommunity(person.id, hq.id);

    const postId = await createDraftPost(adminAgent, csrf, 'Network Wide Media Post');
    await finalizeMedia(adminAgent, csrf, postId, VIDEO);
    await adminAgent.patch(`/api/admin/headquarters-posts/${postId}`).set('X-CSRF-Token', csrf).send({ networkWide: true });
    await adminAgent.post(`/api/admin/headquarters-posts/${postId}/publish`).set('X-CSRF-Token', csrf);

    const res = await memberAgent.get(`/api/me/headquarters-posts/${postId}/media/download-url`);
    expect(res.status).toBe(200);
    expect(res.body.mediaType).toBe('VIDEO');
  });
});

describe('Headquarters Post Media — all four media types', () => {
  it('an image is finalized and downloadable with mediaType IMAGE', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(26);
    const community = await makeCommunity('Media Type Image Community');
    const { agent: memberAgent, person } = await loginAsMember('+237699100006', 'hqm-member6@example.com');
    await joinCommunity(person.id, community.id);

    const postId = await createDraftPost(adminAgent, csrf, 'Image Post');
    const finalized = await finalizeMedia(adminAgent, csrf, postId, IMAGE);
    expect(finalized.body.media.mediaType).toBe('IMAGE');
    await publishTargeted(adminAgent, csrf, postId, [community.id]);

    const res = await memberAgent.get(`/api/me/headquarters-posts/${postId}/media/download-url`);
    expect(res.body.mediaType).toBe('IMAGE');
    const detail = await memberAgent.get(`/api/me/headquarters-posts/${postId}`);
    expect(detail.body.media).toMatchObject({ mediaType: 'IMAGE', originalFilename: IMAGE.originalFilename, byteSize: IMAGE.byteSize });
  });

  it('a video is finalized and downloadable with mediaType VIDEO', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(27);
    const community = await makeCommunity('Media Type Video Community');
    const { agent: memberAgent, person } = await loginAsMember('+237699100007', 'hqm-member7@example.com');
    await joinCommunity(person.id, community.id);

    const postId = await createDraftPost(adminAgent, csrf, 'Video Post');
    const finalized = await finalizeMedia(adminAgent, csrf, postId, VIDEO);
    expect(finalized.body.media.mediaType).toBe('VIDEO');
    await publishTargeted(adminAgent, csrf, postId, [community.id]);

    const res = await memberAgent.get(`/api/me/headquarters-posts/${postId}/media/download-url`);
    expect(res.body.mediaType).toBe('VIDEO');
  });

  it('an audio file is finalized and downloadable with mediaType AUDIO', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(28);
    const community = await makeCommunity('Media Type Audio Community');
    const { agent: memberAgent, person } = await loginAsMember('+237699100008', 'hqm-member8@example.com');
    await joinCommunity(person.id, community.id);

    const postId = await createDraftPost(adminAgent, csrf, 'Audio Post');
    const finalized = await finalizeMedia(adminAgent, csrf, postId, AUDIO);
    expect(finalized.body.media.mediaType).toBe('AUDIO');
    await publishTargeted(adminAgent, csrf, postId, [community.id]);

    const res = await memberAgent.get(`/api/me/headquarters-posts/${postId}/media/download-url`);
    expect(res.body.mediaType).toBe('AUDIO');
  });

  it('a PDF is finalized and downloadable with mediaType PDF', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(29);
    const community = await makeCommunity('Media Type PDF Community');
    const { agent: memberAgent, person } = await loginAsMember('+237699100009', 'hqm-member9@example.com');
    await joinCommunity(person.id, community.id);

    const postId = await createDraftPost(adminAgent, csrf, 'PDF Post');
    const finalized = await finalizeMedia(adminAgent, csrf, postId, PDF);
    expect(finalized.body.media.mediaType).toBe('PDF');
    await publishTargeted(adminAgent, csrf, postId, [community.id]);

    const res = await memberAgent.get(`/api/me/headquarters-posts/${postId}/media/download-url`);
    expect(res.body.mediaType).toBe('PDF');
  });
});

describe('Headquarters Post Media — comments/reactions remain functional on a post with media', () => {
  it('comments and reactions still work normally on a published post that has media attached', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(30);
    const community = await makeCommunity('Media Plus Engagement Community');
    const { agent: memberAgent, csrf: memberCsrf, person } = await loginAsMember('+237699100010', 'hqm-member10@example.com');
    await joinCommunity(person.id, community.id);

    const postId = await createDraftPost(adminAgent, csrf, 'Engagement Post');
    await finalizeMedia(adminAgent, csrf, postId, IMAGE);
    await publishTargeted(adminAgent, csrf, postId, [community.id]);

    const comment = await memberAgent
      .post(`/api/me/headquarters-posts/${postId}/comments`)
      .set('X-CSRF-Token', memberCsrf)
      .send({ body: 'Beautiful!' });
    expect(comment.status).toBe(201);

    const reaction = await memberAgent.post(`/api/me/headquarters-posts/${postId}/reaction`).set('X-CSRF-Token', memberCsrf);
    expect(reaction.status).toBe(200);
    expect(reaction.body.reactionCount).toBe(1);

    const detail = await memberAgent.get(`/api/me/headquarters-posts/${postId}`);
    expect(detail.body.commentCount).toBe(1);
    expect(detail.body.reactionCount).toBe(1);
    expect(detail.body.media).not.toBeNull();
  });
});

describe('Headquarters Post Media — no bypass of existing authorization', () => {
  it('a Member cannot authorize or finalize media (401, not merely excluded from the Admin role check)', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(31);
    const postId = await createDraftPost(adminAgent, csrf, 'Member No Bypass');
    const { agent: memberAgent, csrf: memberCsrf } = await loginAsMember('+237699100011', 'hqm-member11@example.com');

    const authRes = await memberAgent
      .post(`/api/admin/headquarters-posts/${postId}/media/authorize`)
      .set('X-CSRF-Token', memberCsrf)
      .send(IMAGE);
    expect(authRes.status).toBe(401);

    const storageKey = mediaStorageKey(postId);
    const finalizeRes = await memberAgent
      .post(`/api/admin/headquarters-posts/${postId}/media`)
      .set('X-CSRF-Token', memberCsrf)
      .send({ storageKey, ...IMAGE });
    expect(finalizeRes.status).toBe(401);
  });

  it('a nonexistent headquarters post id 404s on every media route rather than leaking a validation path', async () => {
    const { agent, csrf } = await loginAsAdmin(32);
    const fakeId = '00000000-0000-0000-0000-000000000000';

    const authRes = await agent.post(`/api/admin/headquarters-posts/${fakeId}/media/authorize`).set('X-CSRF-Token', csrf).send(IMAGE);
    expect(authRes.status).toBe(404);

    const finalizeRes = await agent
      .post(`/api/admin/headquarters-posts/${fakeId}/media`)
      .set('X-CSRF-Token', csrf)
      .send({ storageKey: mediaStorageKey(fakeId), ...IMAGE });
    expect(finalizeRes.status).toBe(404);
  });
});
