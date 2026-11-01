import { describe, it, expect } from 'vitest';
import { prisma } from '../lib/prisma';
import { processSchoolProgressPost, weeklyPostText } from '../lib/schoolProgressPost';
import { followUpCardsFor } from '../lib/followUpCard';
import { createAdmin } from './helpers';

// The weekly Leadership School progress post congratulates (by name) those who
// passed a school exam that week, in their assembly's group chat, once a week.
// Slow members are never named: their leader sees a flag on their card.
const DAY = 24 * 60 * 60 * 1000;
let n = 0;
const person = (name: string) => {
  n += 1;
  return prisma.person.create({ data: { name, whatsappNumber: `+2376630${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() } });
};

async function world() {
  const admin = await createAdmin('post-admin@test.local', 'AdminPass123!');
  const adminPerson = await person('Evangelist');
  await prisma.user.update({ where: { id: admin.id }, data: { personId: adminPerson.id } });
  const hq = await prisma.community.create({ data: { name: 'Assembly' } });
  await prisma.conversation.create({ data: { communityId: hq.id } });
  const exams: { id: string; order: number }[] = [];
  for (const order of [1, 2]) {
    const book = await prisma.libraryBook.create({ data: { kind: 'TRAINING', titleEn: `Book ${order}`, trainingOrder: order } });
    const exam = await prisma.assessment.create({ data: { titleEn: `E${order}`, passMark: 70, status: 'PUBLISHED', trainingBookId: book.id } });
    exams.push({ id: exam.id, order });
  }
  const member = async (name: string) => {
    const p = await person(name);
    await prisma.communityMembership.create({ data: { personId: p.id, communityId: hq.id, status: 'ACTIVE' } });
    return p;
  };
  const pass = (personId: string, examId: string, daysAgo: number) =>
    prisma.attempt.create({ data: { personId, assessmentId: examId, attemptNumber: 1, status: 'SUBMITTED', passed: true, percentage: 90, submittedAt: new Date(Date.now() - daysAgo * DAY) } });
  return { admin, adminPerson, hq, exams, member, pass };
}

describe('weekly school progress post', () => {
  it('names only those who passed this week, once a week, from the central admin profile', async () => {
    const w = await world();
    const ada = await w.member('Ada');
    const bob = await w.member('Bob');
    const old = await w.member('Old timer');
    await w.pass(ada.id, w.exams[0].id, 2);
    await w.pass(bob.id, w.exams[1].id, 5);
    await w.pass(old.id, w.exams[0].id, 20);

    expect(await processSchoolProgressPost()).toBe(1);
    const conv = await prisma.conversation.findUniqueOrThrow({ where: { communityId: w.hq.id }, include: { messages: true } });
    expect(conv.messages).toHaveLength(1);
    expect(conv.messages[0].senderPersonId).toBe(w.adminPerson.id);
    expect(conv.messages[0].body).toContain('Ada (#1), Bob (#2)');
    expect(conv.messages[0].body).not.toContain('Old timer');
    expect(conv.messages[0].body).toContain('félicitations');

    // Not again the same week.
    expect(await processSchoolProgressPost()).toBe(0);
    expect((await prisma.message.count())).toBe(1);
    // A week later, with nobody new: nothing to post.
    expect(await processSchoolProgressPost(new Date(Date.now() + 8 * DAY))).toBe(0);
  });

  it('does nothing without a central admin profile or without any exam', async () => {
    await createAdmin('post-admin@test.local', 'AdminPass123!');
    expect(await processSchoolProgressPost()).toBe(0);
  });

  it('writes the names in both languages', () => {
    expect(weeklyPostText([{ personId: 'x', name: 'Marie', books: [3] }])).toMatch(/congratulations to Marie \(#3\).*\n\n.*félicitations à Marie \(#3\)/s);
  });
});

describe('a slow member shows as a flag on the leader card, not in the post', () => {
  it('flags someone who started the school and has done nothing for over a month', async () => {
    const w = await world();
    const leader = await person('Leader');
    const slow = await w.member('Slow one');
    const active = await w.member('Active one');
    for (const p of [slow, active]) {
      await prisma.followUpAssignment.create({ data: { followerId: leader.id, followedPersonId: p.id, contextType: 'COMMUNITY', contextId: w.hq.id, assignedByUserId: w.admin.id } });
    }
    await w.pass(slow.id, w.exams[0].id, 45);
    await w.pass(active.id, w.exams[0].id, 3);
    const cards = await followUpCardsFor(leader.id);
    expect(cards.find((c) => c.name === 'Slow one')!.flags).toContain('SCHOOL_SLOW');
    expect(cards.find((c) => c.name === 'Active one')!.flags).not.toContain('SCHOOL_SLOW');
  });
});
