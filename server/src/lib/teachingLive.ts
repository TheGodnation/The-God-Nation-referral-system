import { prisma } from './prisma';
import { pushToPersonsLocalized } from './pushLocalized';
import { rotaTeachingNow } from './teachingCards';
import { groupTeachingNow } from './groupTeachers';

// When someone who is teaching sends their voice notes in the group, the whole group is told, so people know the teaching is
// happening and can come and listen:
//  - the first voice note of a teaching: a loud phone alert ("🔴 {Name} is teaching now") that stays until tapped, and an entry in
//    the bell that opens the group. Once per teaching.
//  - each further voice note of the same teaching: a quiet phone alert only ("🎙️ New teaching audio"), replacing the one before.
// "Teaching" means a teacher on the weekly rota during their slot, or a group teacher on one of their teaching days. Everyone else's
// messages keep the ordinary group alert. Everything here is best effort and never stops the message from being sent.

/** Records that this teaching's start has been announced: true the first time, false when it already was. */
async function claim(key: string): Promise<boolean> {
  const r = await prisma.teachingReminderLog.createMany({ data: [{ key }], skipDuplicates: true });
  return r.count === 1;
}

export interface TeachingAudioInput {
  teacherPersonId: string;
  teacherName: string;
  communityId: string;
  communityName: string;
  /** Everyone in the group who should hear about it (the teacher is left out). */
  recipientIds: string[];
  now?: Date;
}

/**
 * Tells the group about a teacher's voice note, when it is part of a teaching. Returns false when the sender is not teaching right
 * now (the caller then sends the ordinary group alert).
 */
export async function announceTeachingAudio(input: TeachingAudioInput): Promise<boolean> {
  const now = input.now ?? new Date();
  const live = (await rotaTeachingNow(input.teacherPersonId, input.communityId, now)) ?? (await groupTeachingNow(input.teacherPersonId, input.communityId, now).then((g) => (g ? { ...g, topicEn: null, topicFr: null } : null)));
  if (!live) return false;
  const recipients = input.recipientIds.filter((id) => id !== input.teacherPersonId);
  if (recipients.length === 0) return true;
  const url = `/member/chats/group/${input.communityId}`;
  const first = await claim(live.key);
  if (first) {
    // The bell: one entry per member, opening the group.
    await prisma.notification
      .createMany({
        data: recipients.map((recipientPersonId) => ({
          recipientPersonId,
          type: 'TEACHING_ROTA' as const,
          targetType: 'TeachingLive',
          targetId: input.communityId,
          metadata: { kind: 'live', teacherName: input.teacherName, groupName: input.communityName, topicEn: live.topicEn, topicFr: live.topicFr, communityId: input.communityId } as any,
        })),
      })
      .catch(() => {});
    await pushToPersonsLocalized(recipients, (french) => ({
      title: french ? `🔴 ${input.teacherName} enseigne maintenant` : `🔴 ${input.teacherName} is teaching now`,
      body: [french ? live.topicFr ?? live.topicEn : live.topicEn, input.communityName].filter(Boolean).join(' · '),
      url,
      tag: `teaching-live-${input.communityId}`,
      urgent: true,
    }));
  } else {
    await pushToPersonsLocalized(recipients, (french) => ({
      title: french ? `🎙️ ${input.teacherName} · nouvel audio d'enseignement` : `🎙️ ${input.teacherName} · new teaching audio`,
      body: input.communityName,
      url,
      tag: `teaching-live-${input.communityId}`,
    }));
  }
  return true;
}
