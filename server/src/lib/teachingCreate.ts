import { prisma } from './prisma';
import { getOrCreateConversation } from './communityConversation';
import { mediaKindOf } from './teachings';
import { translateAndStoreTeaching } from './translation';
import { pushToPersons } from './push';
import { recordAudit } from './audit';

// Posts a teaching with a quiz in an assembly: the card in the chat (a message with the recording, PDF or video), the quiz, and the
// record that follows who has read or listened and who has taken the quiz. Used when the central admin posts one by hand, and
// when a recorded teaching with a quiz reaches its time (see scheduledTeachings.ts).

const DAY = 24 * 60 * 60 * 1000;
// The notification waits this long for the translation before going out in the original language.
const PUSH_WAITS_FOR_TRANSLATION_MS = 60 * 1000;

export interface TeachingQuestionInput {
  textEn: string;
  textFr?: string;
  options: { textEn: string; textFr?: string; isCorrect: boolean }[];
}

export interface TeachingInput {
  communityId: string;
  personId: string;
  title: string;
  text: string | null;
  attachment?: { storageKey: string; originalFilename: string; mimeType: string; byteSize: number; thumb?: string; pageCount?: number };
  questions: TeachingQuestionInput[];
  passMark: number;
  openDays: number;
  portion?: { bookId: string; page: number; label?: string };
}

export async function createTeachingWithQuiz(d: TeachingInput) {
  const mediaKind = d.attachment ? mediaKindOf(d.attachment.mimeType) : null;
  const conversation = await getOrCreateConversation(d.communityId);
  const closesAt = new Date(Date.now() + d.openDays * DAY);
  const personId = d.personId;

  const teaching = await prisma.$transaction(async (tx) => {
    const assessment = await tx.assessment.create({
      data: {
        titleEn: `Teaching quiz: ${d.title}`.slice(0, 250),
        passMark: d.passMark,
        maxAttempts: 1,
        status: 'PUBLISHED',
        questions: {
          create: d.questions.map((q, qi) => ({
            textEn: q.textEn,
            textFr: q.textFr || null,
            order: qi,
            options: { create: q.options.map((o, oi) => ({ textEn: o.textEn, textFr: o.textFr || null, isCorrect: o.isCorrect, order: oi })) },
          })),
        },
      },
    });
    // The teaching sits in the assembly's chat like any message (its file is
    // the message's attachment), shown there as a card.
    const message = await tx.message.create({
      data: {
        conversationId: conversation.id,
        senderPersonId: personId,
        body: d.title,
        attachments: d.attachment
          ? {
              create: [
                {
                  storageKey: d.attachment.storageKey,
                  originalFilename: d.attachment.originalFilename,
                  mimeType: d.attachment.mimeType,
                  byteSize: d.attachment.byteSize,
                  thumbDataUrl: d.attachment.thumb ?? null,
                  pageCount: d.attachment.pageCount ?? null,
                  uploadedByPersonId: personId,
                },
              ],
            }
          : undefined,
      },
    });
    return tx.teaching.create({
      data: {
        communityId: d.communityId,
        messageId: message.id,
        assessmentId: assessment.id,
        authorPersonId: personId,
        title: d.title,
        text: d.text,
        mediaKind,
        closesAt,
        portionBookId: d.portion?.bookId ?? null,
        portionPage: d.portion?.page ?? null,
        portionLabel: d.portion?.label || null,
      },
    });
  });

  await recordAudit({ action: 'TEACHING_POSTED', targetType: 'Teaching', targetId: teaching.id, metadata: { communityId: d.communityId, questions: d.questions.length } });

  // English <-> French in the background (members see it as soon as it lands).
  // Everyone else in the assembly hears about it, even with the app closed —
  // once the translation is ready, so each person's notification is in their
  // own language (the original title if it isn't ready in time).
  void (async () => {
    const translating = translateAndStoreTeaching(teaching.id).catch(() => {});
    let giveUp: NodeJS.Timeout | undefined;
    await Promise.race([translating, new Promise((resolve) => { giveUp = setTimeout(resolve, PUSH_WAITS_FOR_TRANSLATION_MS); })]);
    clearTimeout(giveUp);
    const [community, recipients, translated] = await Promise.all([
      prisma.community.findUnique({ where: { id: d.communityId }, select: { name: true } }),
      prisma.communityMembership.findMany({
        where: { communityId: d.communityId, status: 'ACTIVE', personId: { not: personId } },
        select: { personId: true, person: { select: { preferredLanguage: true } } },
      }),
      prisma.teaching.findUnique({ where: { id: teaching.id }, select: { detectedLanguage: true, titleTranslated: true } }),
    ]);
    for (const language of ['en', 'fr'] as const) {
      const ids = recipients.filter((r) => r.person.preferredLanguage === language).map((r) => r.personId);
      const title = translated?.titleTranslated && translated.detectedLanguage && translated.detectedLanguage !== language ? translated.titleTranslated : d.title;
      await pushToPersons(ids, {
        title: `${language === 'fr' ? '📖 Nouvel enseignement' : '📖 New teaching'} • ${community?.name ?? ''}`.trim(),
        body: title.length > 120 ? `${title.slice(0, 120)}…` : title,
        url: `/member/teachings/${teaching.id}`,
      });
    }
  })().catch(() => {});

  return teaching;
}
