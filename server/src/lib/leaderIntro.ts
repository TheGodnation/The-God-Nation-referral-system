import { prisma } from './prisma';
import { sendPrivateNotice, isFrench, languagesOf } from './privateNotice';
import { pushToPersons } from './push';
import { profilePhotoPath } from './profilePhoto';
import { isCentralAdminPerson } from './centralAdmin';

// "Your leader": when a person is assigned to a leader, the person is told who it is: a notification and a first
// private message from the leader. This happens once the leader has opened their dashboard (so somebody is ready to
// answer), and only once per assignment (introducedAt). The person's Home page also shows a card with their leader.

export const introMessage = (leaderName: string, french: boolean): string =>
  french
    ? `Bonjour, je suis ${leaderName}, de l’équipe de leadership. J’ai été désigné(e) comme votre responsable, pour vous suivre et marcher avec vous. Vous pouvez m’écrire ici à tout moment.`
    : `Hello, I'm ${leaderName}, from the Leadership Team. I've been assigned as your leader, to follow you up and walk with you. You can write to me here any time.`;

/**
 * Tells the people who were assigned to this leader and have not yet been told. Safe to call every time the leader
 * opens their dashboard: each assignment is claimed once, so nobody is told twice. Returns how many were told.
 */
export async function introducePendingAssignments(leaderPersonId: string): Promise<number> {
  const isLeader = await prisma.roleAssignment.findFirst({ where: { personId: leaderPersonId, roleType: 'SCOPED_LEADER', status: 'ACTIVE' }, select: { id: true } });
  if (!isLeader) return 0;
  const leader = await prisma.person.findUnique({ where: { id: leaderPersonId }, select: { name: true } });
  if (!leader) return 0;

  const pending = await prisma.followUpAssignment.findMany({
    where: { followerId: leaderPersonId, status: 'ACTIVE', introducedAt: null, followedPerson: { erasedAt: null } },
    select: { id: true, followedPersonId: true },
    take: 500,
  });
  if (pending.length === 0) return 0;
  const langs = await languagesOf(pending.map((p) => p.followedPersonId));

  let told = 0;
  for (const a of pending) {
    // The central admin is never told about a leader (they follow up the leaders, not the other way round).
    if (await isCentralAdminPerson(a.followedPersonId)) continue;
    // Claim it first: if two requests arrive together, only one of them goes on to send.
    const claimed = await prisma.followUpAssignment.updateMany({ where: { id: a.id, introducedAt: null }, data: { introducedAt: new Date() } });
    if (claimed.count !== 1) continue;
    const french = isFrench(langs.get(a.followedPersonId));
    await prisma.notification.create({
      data: { recipientPersonId: a.followedPersonId, type: 'LEADER_ASSIGNED', targetType: 'Person', targetId: leaderPersonId, metadata: { leaderName: leader.name } as any },
    }).catch(() => {});
    pushToPersons([a.followedPersonId], {
      title: french ? 'Votre responsable' : 'Your leader',
      body: french ? `${leader.name}, de l’équipe de leadership, a été désigné(e) pour vous suivre.` : `${leader.name}, from the Leadership Team, has been assigned to follow you up.`,
      url: `/member/people/${leaderPersonId}`,
    }).catch(() => {});
    await sendPrivateNotice(leaderPersonId, a.followedPersonId, introMessage(leader.name, french));
    told++;
  }
  return told;
}

/** The leader a person has been told about (the most recent active assignment that has been introduced), or null. */
export async function myLeaderOf(personId: string) {
  if (await isCentralAdminPerson(personId)) return null;
  const a = await prisma.followUpAssignment.findFirst({
    where: { followedPersonId: personId, status: 'ACTIVE', introducedAt: { not: null }, follower: { erasedAt: null } },
    orderBy: { assignedAt: 'desc' },
    select: { follower: { select: { id: true, name: true, photoStorageKey: true, photoUpdatedAt: true } } },
  });
  if (!a) return null;
  return { personId: a.follower.id, name: a.follower.name, photoUrl: profilePhotoPath(a.follower) };
}
