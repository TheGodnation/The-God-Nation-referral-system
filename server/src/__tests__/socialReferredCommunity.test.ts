import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { bootstrap } from './testUtils';

// Section 3/32: a Person's friends split into two community-visible
// buckets, each with its own count — "Referred" (joined through this
// Person's own code; Leader-attribution and Member-code auto-friends
// combined) and "Community" (ordinary friend-request-based friendships).
// See lib/social.ts's getFriendBreakdown and social.ts's
// GET /people/:personId{,/referred,/community}.
const app = createApp();

let n = 0;
async function makeMember(name: string) {
  n += 1;
  const person = await prisma.person.create({ data: { name, whatsappNumber: `+237672${String(100000 + n).padStart(6, '0')}` } });
  const email = `social-refcomm-${n}@test.local`;
  await prisma.memberAccount.create({ data: { personId: person.id, email, passwordHash: 'irrelevant' } });
  return { person, email };
}

describe('GET /api/member/people/:personId — referredCount/communityCount', () => {
  it('splits an auto-friended referral (REFERRAL origin, as requester) into Referred, and an ordinary accepted friend request into Community', async () => {
    const { person: referrer, email: referrerEmail } = await makeMember('Referrer Person');
    const { person: joiner } = await makeMember('Joiner Person');
    const { person: buddy } = await makeMember('Buddy Person');
    const { person: viewer, email: viewerEmail } = await makeMember('Viewer Person');
    void viewerEmail;

    // Simulates what memberAuth.ts's /signup/finish creates for a referral-code join.
    await prisma.friendship.create({
      data: { requesterPersonId: referrer.id, addresseePersonId: joiner.id, status: 'ACCEPTED', respondedAt: new Date(), origin: 'REFERRAL' },
    });
    // An ordinary, organic accepted friendship.
    await prisma.friendship.create({
      data: { requesterPersonId: referrer.id, addresseePersonId: buddy.id, status: 'ACCEPTED', respondedAt: new Date(), origin: 'ORGANIC' },
    });

    // Set a real password so we can log in through the normal endpoint.
    const bcrypt = (await import('bcryptjs')).default;
    await prisma.memberAccount.update({ where: { email: viewerEmail }, data: { passwordHash: bcrypt.hashSync('Testpass123', 10) } });
    const agent = request.agent(app);
    const { csrf } = await bootstrap(agent);
    await agent.post('/api/member/auth/login').set('X-CSRF-Token', csrf).send({ email: viewerEmail, password: 'Testpass123' });

    const res = await agent.get(`/api/member/people/${referrer.id}`);
    expect(res.status).toBe(200);
    expect(res.body.referredCount).toBe(1);
    expect(res.body.communityCount).toBe(1);
    expect(res.body.friendCount).toBe(2);

    const referredList = await agent.get(`/api/member/people/${referrer.id}/referred`);
    expect(referredList.body.items.map((i: any) => i.personId)).toEqual([joiner.id]);

    const communityList = await agent.get(`/api/member/people/${referrer.id}/community`);
    expect(communityList.body.items.map((i: any) => i.personId)).toEqual([buddy.id]);

    void referrerEmail;
  });

  it("the person who referred ME shows up in MY Community bucket, not my Referred bucket (asymmetric by design)", async () => {
    const { person: referrer } = await makeMember('Asym Referrer');
    const { person: joiner, email: joinerEmail } = await makeMember('Asym Joiner');

    await prisma.friendship.create({
      data: { requesterPersonId: referrer.id, addresseePersonId: joiner.id, status: 'ACCEPTED', respondedAt: new Date(), origin: 'REFERRAL' },
    });

    const bcrypt = (await import('bcryptjs')).default;
    await prisma.memberAccount.update({ where: { email: joinerEmail }, data: { passwordHash: bcrypt.hashSync('Testpass123', 10) } });
    const agent = request.agent(app);
    const { csrf } = await bootstrap(agent);
    await agent.post('/api/member/auth/login').set('X-CSRF-Token', csrf).send({ email: joinerEmail, password: 'Testpass123' });

    const res = await agent.get(`/api/member/people/${joiner.id}`);
    expect(res.status).toBe(200);
    expect(res.body.referredCount).toBe(0);
    expect(res.body.communityCount).toBe(1);
  });
});
