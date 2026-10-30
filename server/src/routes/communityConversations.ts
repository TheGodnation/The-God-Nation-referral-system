import { appLanguage } from '../lib/appLanguage';
import { cardStatesFor, cardTotalsFor } from '../lib/teachings';
import { badgeOf, centralAdminAmong, isCentralAdminPerson } from '../lib/centralAdmin';
import { MAX_MESSAGE_CHARS } from '../lib/textLimits';
import { reactorList } from '../lib/reactionList';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireCsrf } from '../lib/csrf';
import {
  messageSendLimiter,
  communityConversationReadLimiter,
  communityModerationLimiter,
  messageHideLimiter,
  messageReactionLimiter,
  typingLimiter,
  attachmentUploadAuthorizeLimiter,
  attachmentDownloadLimiter,
  chatSearchLimiter,
} from '../lib/rateLimit';
import { asyncHandler } from '../lib/asyncHandler';
import { resolveActingPersonId, contextTargetExists, isCommunityAdministrator } from '../lib/leadership';
import { recordAudit } from '../lib/audit';
import {
  hasConversationAccess,
  canPostCommunityMessage,
  getOrCreateConversation,
  markCommunityConversationRead,
  getCommunityConversationUnreadCount,
  historyCutoffFor,
  hideMessageForPerson,
} from '../lib/communityConversation';
import {
  isAllowedAttachmentMime,
  maxBytesForMime,
  isValidOriginalFilename,
  isStorageKeyForCommunity,
  generateStorageKey,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ORIGINAL_FILENAME_LENGTH,
  MAX_THUMB_DATA_URL_LENGTH,
  MAX_PDF_PAGE_COUNT,
  THUMB_DATA_URL_PATTERN,
} from '../lib/attachmentPolicy';
import { isStorageConfigured, createUploadUrl, createDownloadUrl, headObject } from '../lib/storage';
import { profilePhotoPath, groupPhotoPath } from '../lib/profilePhoto';
import { communityAudience, groupMessageReceipt, isOnline, setTyping, clearTyping, whoIsTyping, whoIsRecording } from '../lib/presence';
import { EDIT_WINDOW_MS, UNSEND_WINDOW_MS, editMessageSchema, searchQuerySchema } from '../lib/chatActions';
import { pushToPersons } from '../lib/push';
import { translateAndStoreMessage, transcribeAndStoreMessageAudio } from '../lib/translation';
import type { Language } from '@prisma/client';

// WhatsApp-style quick reactions. A short fixed list keeps it simple and
// stops anyone storing arbitrary text as a "reaction".
export const ALLOWED_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;

type ReactionRow = { emoji: string; personId: string };

function summarizeReactions(rows: ReactionRow[], viewerPersonId: string) {
  const byEmoji = new Map<string, { emoji: string; count: number; mine: boolean }>();
  for (const r of rows) {
    const entry = byEmoji.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false };
    entry.count += 1;
    if (r.personId === viewerPersonId) entry.mine = true;
    byEmoji.set(r.emoji, entry);
  }
  return ALLOWED_REACTIONS.filter((e) => byEmoji.has(e)).map((e) => byEmoji.get(e)!);
}

type ReplySource = {
  id: string;
  body: string | null;
  deletedAt: Date | null;
  sender: { name: string };
  attachments: { mimeType: string }[];
} | null;

// A short preview of the message being replied to (never the body of a
// removed message).
function replyPreview(r: ReplySource) {
  if (!r) return null;
  return {
    id: r.id,
    senderName: r.sender.name,
    body: r.deletedAt ? null : r.body,
    deleted: Boolean(r.deletedAt),
    attachmentMimeType: r.deletedAt ? null : r.attachments[0]?.mimeType ?? null,
  };
}

type TranslatableMessage = {
  deletedAt: Date | null;
  detectedLanguage: Language | null;
  translatedBody: string | null;
  transcribedLanguage: Language | null;
  transcribedBody: string | null;
  translatedTranscript: string | null;
};

// Only ever present once a background translation has actually landed, and
// only when it differs from the viewer's own language — someone reading in
// the message's own language never sees this, same as a post that needs no
// translation at all. A moderated/deleted message never exposes it either,
// same redaction rule as `body` itself.
function translationField(m: TranslatableMessage, viewerLanguage: Language | null) {
  if (m.deletedAt || !m.detectedLanguage || !viewerLanguage || m.detectedLanguage === viewerLanguage || !m.translatedBody) {
    return null;
  }
  return { sourceLanguage: m.detectedLanguage, translatedBody: m.translatedBody };
}

// The transcript is shown whenever it's ready, regardless of language — it
// has its own value (text you can read without playing the audio) even in
// the viewer's own language. Only when the spoken language differs from the
// viewer's is the shown text itself a translation, with the plain transcript
// one tap away via `original`.
function transcriptField(m: TranslatableMessage, viewerLanguage: Language | null) {
  if (m.deletedAt || !m.transcribedLanguage || !m.transcribedBody) return null;
  const needsTranslation = viewerLanguage && m.transcribedLanguage !== viewerLanguage && m.translatedTranscript;
  return {
    sourceLanguage: m.transcribedLanguage,
    text: needsTranslation ? m.translatedTranscript! : m.transcribedBody,
    translated: Boolean(needsTranslation),
    original: needsTranslation ? m.transcribedBody : null,
  };
}

const replyToInclude = {
  select: {
    id: true,
    body: true,
    deletedAt: true,
    sender: { select: { name: true } },
    attachments: { select: { mimeType: true }, take: 1 },
  },
} as const;

declare global {
  namespace Express {
    interface Request {
      // Phase 3M.1: the acting Member's or Leader's own linked Person id,
      // set only by requireConversationActor below — never derived from
      // client input. Admin never gets one (Admin has no routine
      // conversation access in this phase — see communityConversation.ts).
      conversationActorPersonId?: string;
    }
  }
}

const router = Router();

/**
 * Resolves the caller's own Person identity for conversation purposes —
 * either an authenticated Member (req.member, set by loadMemberSession) or
 * an authenticated Leader (req.user with role LEADER, resolved via the
 * existing User.personId link). An Admin's req.user is deliberately never
 * resolved here: Phase 3M.1 has no Admin conversation-browsing route.
 */
async function resolveConversationActorPersonId(req: Request): Promise<string | null> {
  if (req.member) return req.member.personId;
  if (req.user?.role === 'LEADER') return resolveActingPersonId(req.user.id);
  return null;
}

async function requireConversationActor(req: Request, res: Response, next: NextFunction) {
  const personId = await resolveConversationActorPersonId(req);
  if (!personId) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  req.conversationActorPersonId = personId;
  next();
}

router.use(requireConversationActor);

// GET /api/communities/:communityId/conversation — conversation metadata
// only (no messages). 404 for a Community that doesn't exist at all; 403
// for a real Community the caller has no current relationship to — mirrors
// the existing contextTargetExists / findActiveScopedRole two-step check
// already used by leaderFollowUps.ts.
router.get('/:communityId/conversation', asyncHandler(async (req, res) => {
  const { communityId } = req.params;

  if (!(await contextTargetExists('COMMUNITY', communityId))) {
    return res.status(404).json({ error: 'Community not found.' });
  }

  const personId = req.conversationActorPersonId!;
  if (!(await hasConversationAccess(personId, communityId))) {
    return res.status(403).json({ error: 'You do not have access to this community\'s conversation.' });
  }

  const conversation = await getOrCreateConversation(communityId);
  const cutoff = await historyCutoffFor(personId, communityId, conversation.id);
  const [unreadCount, isAdministrator, community, last] = await Promise.all([
    getCommunityConversationUnreadCount(personId, conversation.id, communityId),
    isCommunityAdministrator(personId, communityId),
    prisma.community.findUnique({
      where: { id: communityId },
      select: { id: true, name: true, photoStorageKey: true, photoUpdatedAt: true, aboutEn: true, aboutFr: true },
    }),
    prisma.message.findFirst({
      where: { conversationId: conversation.id, NOT: { hiddenFor: { some: { personId } } }, ...(cutoff ? { createdAt: { gte: cutoff } } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { sender: { select: { name: true } }, attachments: { select: { mimeType: true }, take: 1 } },
    }),
  ]);
  res.json({
    id: conversation.id,
    communityId: conversation.communityId,
    createdAt: conversation.createdAt,
    unreadCount,
    isAdministrator,
    // Only the central admin's profile can post a teaching in an assembly.
    canPostTeaching: await isCentralAdminPerson(personId),
    // The same profile can also add people and make sub-assemblies (communityManage.ts).
    canManage: await isCentralAdminPerson(personId),
    // For the WhatsApp-style chat list and chat header.
    name: community?.name ?? null,
    photoUrl: community ? groupPhotoPath(community) : null,
    aboutEn: community?.aboutEn ?? null,
    aboutFr: community?.aboutFr ?? null,
    lastMessage: last
      ? {
          senderName: last.sender.name,
          isOwn: last.senderPersonId === personId,
          body: last.deletedAt ? null : last.body,
          deleted: Boolean(last.deletedAt),
          deletedBySender: Boolean(last.deletedAt) && last.deletedByPersonId === last.senderPersonId,
          attachmentMimeType: last.deletedAt ? null : last.attachments[0]?.mimeType ?? null,
          createdAt: last.createdAt,
        }
      : null,
  });
}));

const DEFAULT_MESSAGE_PAGE_SIZE = 30;
const MAX_MESSAGE_PAGE_SIZE = 50;

const listMessagesQuerySchema = z.object({
  before: z.string().optional(),
  // Light polling: only messages newer than this one (plus a tiny list of
  // what changed on the most recent messages) — see `recent` below.
  after: z.string().optional(),
  // A requested limit above the maximum is capped, not rejected — a client
  // asking for "too much" is not a malformed request.
  limit: z.coerce.number().int().min(1).optional(),
});

// GET /api/communities/:communityId/conversation/messages — cursor-paginated,
// newest-first internally, returned oldest-first for direct rendering.
// `before` must be a message id that actually belongs to THIS conversation
// — never trusted as a bound on any other conversation's messages.
router.get('/:communityId/conversation/messages', asyncHandler(async (req, res) => {
  const { communityId } = req.params;

  if (!(await contextTargetExists('COMMUNITY', communityId))) {
    return res.status(404).json({ error: 'Community not found.' });
  }

  const personId = req.conversationActorPersonId!;
  if (!(await hasConversationAccess(personId, communityId))) {
    return res.status(403).json({ error: 'You do not have access to this community\'s conversation.' });
  }

  const parsed = listMessagesQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid pagination parameters.' });
  }
  const limit = Math.min(parsed.data.limit ?? DEFAULT_MESSAGE_PAGE_SIZE, MAX_MESSAGE_PAGE_SIZE);

  const conversation = await getOrCreateConversation(communityId);
  // A newcomer sees only the last 10 earlier messages and what came since.
  const cutoff = await historyCutoffFor(personId, communityId, conversation.id);

  let cursor: { createdAt: Date; id: string } | null = null;
  if (parsed.data.before) {
    const cursorMessage = await prisma.message.findUnique({ where: { id: parsed.data.before } });
    if (!cursorMessage || cursorMessage.conversationId !== conversation.id) {
      return res.status(400).json({ error: 'Invalid pagination cursor.' });
    }
    cursor = { createdAt: cursorMessage.createdAt, id: cursorMessage.id };
  }
  let afterCursor: { createdAt: Date; id: string } | null = null;
  if (parsed.data.after && !parsed.data.before) {
    const afterMessage = await prisma.message.findUnique({ where: { id: parsed.data.after } });
    if (!afterMessage || afterMessage.conversationId !== conversation.id) {
      return res.status(400).json({ error: 'Invalid pagination cursor.' });
    }
    afterCursor = { createdAt: afterMessage.createdAt, id: afterMessage.id };
  }

  const rows = await prisma.message.findMany({
    where: {
      conversationId: conversation.id,
      // Phase 3M.8C: a message this Person personally hid ("delete for me")
      // never appears in their own view again — other participants' queries
      // are completely unaffected, since this filters on personId, not on
      // the shared Message row itself.
      NOT: { hiddenFor: { some: { personId } } },
      ...(cutoff ? { AND: [{ createdAt: { gte: cutoff } }] } : {}),
      ...(cursor
        ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] }
        : {}),
      ...(afterCursor
        ? { OR: [{ createdAt: { gt: afterCursor.createdAt } }, { createdAt: afterCursor.createdAt, id: { gt: afterCursor.id } }] }
        : {}),
    },
    include: {
      sender: { select: { id: true, name: true, photoStorageKey: true, photoUpdatedAt: true } },
      attachments: { select: { id: true, originalFilename: true, mimeType: true, byteSize: true, thumbDataUrl: true, pageCount: true, language: true } },
      replyTo: replyToInclude,
      reactions: { select: { emoji: true, personId: true } },
      teaching: { select: { id: true, title: true, assessmentId: true, mediaKind: true, closesAt: true, text: true, communityId: true, authorPersonId: true, detectedLanguage: true, titleTranslated: true } },
    },
    orderBy: afterCursor ? [{ createdAt: 'asc' }, { id: 'asc' }] : [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });

  const hasMore = afterCursor ? false : rows.length > limit;
  // More new messages than one page: the app simply reloads the latest page.
  const newerOverflow = afterCursor ? rows.length > limit : undefined;
  const page = afterCursor ? rows.slice(0, limit) : rows.slice(0, limit).reverse();
  const unreadCount = await getCommunityConversationUnreadCount(personId, conversation.id, communityId);
  const isAdministrator = await isCommunityAdministrator(personId, communityId);
  // Community Posting Policy — a read-only hint so the client can hide/
  // disable its composer without a failed round-trip; never itself an
  // authorization decision (see the POST route below, which independently
  // re-checks canPostCommunityMessage on every send regardless of this).
  const canPost = await canPostCommunityMessage(personId, communityId);

  // Ticks on the viewer's own messages, how many are online, and who is
  // typing — the WhatsApp details.
  const [audience, reads, viewerPerson, coordinators] = await Promise.all([
    communityAudience(communityId),
    prisma.communityConversationRead.findMany({ where: { conversationId: conversation.id }, select: { personId: true, lastReadAt: true } }),
    prisma.person.findUnique({ where: { id: personId }, select: { preferredLanguage: true } }),
    centralAdminAmong(page.map((m) => m.senderPersonId)),
  ]);
  const readAtByPerson = new Map(reads.map((r) => [r.personId, r.lastReadAt]));
  const viewerLanguage = appLanguage(req, viewerPerson?.preferredLanguage);
  // Teachings in this page: the card shows where the viewer is with each.
  const cardStates = await cardStatesFor(personId, page.flatMap((m) => (m.teaching ? [m.teaching] : [])));
  const cardTotals = await cardTotalsFor(page.flatMap((m) => (m.teaching ? [m.teaching] : [])));
  const now = Date.now();

  res.json({
    // Phase 3M.8A: a moderated message's original body is never sent to
    // ordinary participants — only `deleted: true`. The row itself (and its
    // real body) is preserved server-side for future Central Authority
    // investigative access (Phase 3M.8B), never exposed here.
    // Phase 3M.8C: attachments follow the same redaction — a moderated
    // message's attachments are never listed to ordinary participants
    // either, only its metadata rows preserved server-side. Never exposes
    // storageKey — a download requires a dedicated, re-authorized route
    // (see .../attachments/:attachmentId/download-url below).
    items: page.map((m) => ({
      id: m.id,
      senderName: m.sender.name,
      // "National Coordinator" next to the central admin's name.
      senderBadge: badgeOf(coordinators, m.senderPersonId),
      senderPhotoUrl: profilePhotoPath(m.sender),
      // Tapping a sender's name/photo opens their profile wall, the same as
      // everywhere else a name/photo is shown (members list, photo slider,
      // directory) — all of which already reveal this same personId<->name
      // mapping, so exposing it here tells a group member nothing they
      // couldn't already see from who's in the group and what they posted.
      senderPersonId: m.senderPersonId,
      // Phase 3M.8C — lets the client show its own "delete for me" action
      // only on the caller's own messages, mirroring isCommunityAdministrator
      // being resolved server-side rather than trusted from the client.
      isOwn: m.senderPersonId === personId,
      body: m.deletedAt ? null : m.body,
      teaching:
        m.deletedAt || !m.teaching
          ? null
          : {
              id: m.teaching.id,
              // In the viewer's own language when the teaching was written in the other one.
              title: m.teaching.titleTranslated && m.teaching.detectedLanguage && m.teaching.detectedLanguage !== viewerLanguage ? m.teaching.titleTranslated : m.teaching.title,
              mediaKind: m.teaching.mediaKind,
              hasText: Boolean(m.teaching.text),
              closesAt: m.teaching.closesAt,
              myState: cardStates.get(m.teaching.id)?.state ?? 'NEW',
              myPercentage: cardStates.get(m.teaching.id)?.percentage ?? null,
              totals: cardTotals.get(m.teaching.id) ?? null,
            },
      translation: translationField(m, viewerLanguage),
      transcript: transcriptField(m, viewerLanguage),
      createdAt: m.createdAt,
      deleted: Boolean(m.deletedAt),
      // "This message was deleted" (by the sender) vs "removed" by a leader.
      deletedBySender: Boolean(m.deletedAt) && m.deletedByPersonId === m.senderPersonId,
      edited: !m.deletedAt && Boolean(m.editedAt),
      forwarded: !m.deletedAt && m.forwarded,
      attachments: m.deletedAt
        ? []
        : m.attachments.map((a) => ({
            id: a.id,
            originalFilename: a.originalFilename,
            mimeType: a.mimeType,
            byteSize: a.byteSize,
            thumb: a.thumbDataUrl ?? undefined,
            pageCount: a.pageCount ?? undefined,
            language: a.language ?? undefined,
          })),
      liveTeaching: !m.deletedAt && m.liveTeaching ? true : undefined,
      replyTo: m.deletedAt ? null : replyPreview(m.replyTo),
      reactions: m.deletedAt ? [] : summarizeReactions(m.reactions, personId),
      status: m.senderPersonId === personId ? groupMessageReceipt(m, audience, readAtByPerson).status : undefined,
    })),
    newerOverflow,
    // Light polling: what changed on the 30 most recent messages (ticks,
    // reactions, removals) — a few hundred bytes instead of the full page.
    recent: afterCursor
      ? (
          await prisma.message.findMany({
            where: { conversationId: conversation.id, NOT: { hiddenFor: { some: { personId } } }, ...(cutoff ? { createdAt: { gte: cutoff } } : {}) },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            // The latest 60: reactions, ticks, edits and deletions on them refresh by themselves.
            take: 60,
            select: {
              id: true,
              createdAt: true,
              deletedAt: true,
              deletedByPersonId: true,
              editedAt: true,
              body: true,
              senderPersonId: true,
              detectedLanguage: true,
              translatedBody: true,
              transcribedLanguage: true,
              transcribedBody: true,
              translatedTranscript: true,
              reactions: { select: { emoji: true, personId: true } },
            },
          })
        ).map((m) => ({
          id: m.id,
          deleted: Boolean(m.deletedAt),
          deletedBySender: m.deletedAt ? m.deletedByPersonId === m.senderPersonId : undefined,
          // An edited message's new text (only sent when it was edited).
          ...(m.editedAt && !m.deletedAt ? { edited: true, body: m.body } : {}),
          // A translation/transcript that landed since the last poll — these
          // are simply the current cached values, same as the main page's
          // own mapping; a message not yet translated keeps polling null
          // until it is.
          translation: translationField(m, viewerLanguage),
          transcript: transcriptField(m, viewerLanguage),
          reactions: m.deletedAt ? [] : summarizeReactions(m.reactions, personId),
          status: m.senderPersonId === personId ? groupMessageReceipt(m, audience, readAtByPerson).status : undefined,
        }))
      : undefined,
    memberCount: audience.length,
    onlineCount: audience.filter((a) => a.personId === personId || isOnline(a.lastSeenAt, now)).length,
    typing: whoIsTyping(`group:${conversation.id}`, personId),
    recording: whoIsRecording(`group:${conversation.id}`, personId),
    hasMore,
    unreadCount,
    isAdministrator,
    canPost,
  });
}));

const attachmentDescriptorSchema = z.object({
  storageKey: z.string().min(1),
  originalFilename: z.string().trim().min(1).max(MAX_ORIGINAL_FILENAME_LENGTH),
  mimeType: z.string().min(1),
  byteSize: z.number().int().positive(),
  // A tiny blurred preview of a photo (a few KB), shown before the real
  // photo downloads — see lib/attachmentPolicy.ts THUMB_DATA_URL_PATTERN.
  thumb: z.string().max(MAX_THUMB_DATA_URL_LENGTH).regex(THUMB_DATA_URL_PATTERN).optional(),
  pageCount: z.number().int().min(1).max(MAX_PDF_PAGE_COUNT).optional(),
  // Only the central admin's two-language voice message uses this (anyone else's is ignored).
  language: z.enum(['en', 'fr']).optional(),
});

// Phase 3M.8C: body is now optional (an attachment-only message is valid),
// but a message must never be completely empty — the .refine below is the
// one place that rule is actually enforced; Message.body's own nullability
// says nothing about it by itself (see that column's schema comment).
const sendMessageSchema = z
  .object({
    // WhatsApp's own per-message character limit — the client enforces the same.
    body: z.string().trim().max(MAX_MESSAGE_CHARS).optional(),
    attachments: z.array(attachmentDescriptorSchema).max(MAX_ATTACHMENTS_PER_MESSAGE).optional(),
    replyToMessageId: z.string().min(1).optional(),
    // Only honoured for the central admin: this message is a live teaching.
    liveTeaching: z.boolean().optional(),
  })
  .refine((d) => Boolean(d.body && d.body.length > 0) || Boolean(d.attachments && d.attachments.length > 0), {
    message: 'A message must include text or at least one attachment.',
  });

// POST /api/communities/:communityId/conversation/messages — senderPersonId
// is always req.conversationActorPersonId, never accepted from the body.
router.post(
  '/:communityId/conversation/messages',
  messageSendLimiter,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const { communityId } = req.params;

    if (!(await contextTargetExists('COMMUNITY', communityId))) {
      return res.status(404).json({ error: 'Community not found.' });
    }

    const personId = req.conversationActorPersonId!;
    // Community Posting Policy — this is the sole creation gate (never
    // hasConversationAccess directly): under EVERYONE it delegates to the
    // exact same check as before, so existing posting behavior is
    // unchanged; under LEADERS_ONLY it additionally requires an active
    // exact-Community SCOPED_LEADER. Read routes above are untouched.
    if (!(await canPostCommunityMessage(personId, communityId))) {
      return res.status(403).json({ error: 'You do not have permission to post in this community.' });
    }

    const parsed = sendMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid message.' });
    }
    // The central admin's own extras: a voice message recorded in both languages
    // (an English and a French clip, each labelled) and the "live teaching" mark.
    // For anyone else they are simply dropped.
    const isAdminSender = await isCentralAdminPerson(personId);
    const rawDescriptors = parsed.data.attachments ?? [];
    const audioCount = rawDescriptors.filter((a) => a.mimeType.startsWith('audio/')).length;
    const labelled = isAdminSender && rawDescriptors.length === 2 && audioCount === 2 && rawDescriptors[0].language && rawDescriptors[1].language && rawDescriptors[0].language !== rawDescriptors[1].language;
    const attachmentDescriptors = rawDescriptors.map((a) => ({ ...a, language: labelled ? a.language : undefined }));
    const liveTeaching = isAdminSender && parsed.data.liveTeaching === true;

    // Phase 3M.8C — re-validates every attachment descriptor at the one
    // point that actually matters (finalization), never trusting whatever
    // the client echoes back from the authorize step. A storage key that
    // doesn't match THIS Community's own namespace is rejected outright —
    // see isStorageKeyForCommunity's own comment for why that alone already
    // prevents attaching another Community's (or a fabricated) object.
    for (const a of attachmentDescriptors) {
      if (!isStorageKeyForCommunity(a.storageKey, communityId)) {
        return res.status(400).json({ error: 'Invalid attachment reference.' });
      }
      if (!isAllowedAttachmentMime(a.mimeType)) {
        return res.status(400).json({ error: 'Unsupported attachment type.' });
      }
      const maxBytes = maxBytesForMime(a.mimeType)!;
      if (a.byteSize > maxBytes) {
        return res.status(400).json({ error: 'Attachment is too large.' });
      }
      if (!isValidOriginalFilename(a.originalFilename)) {
        return res.status(400).json({ error: 'Invalid attachment filename.' });
      }
    }
    // storageKey is @unique on MessageAttachment — reject a duplicate
    // within one message explicitly (400) rather than letting Prisma's
    // own unique-constraint violation surface as an opaque 500.
    if (new Set(attachmentDescriptors.map((a) => a.storageKey)).size !== attachmentDescriptors.length) {
      return res.status(400).json({ error: 'Duplicate attachment reference.' });
    }

    if (attachmentDescriptors.length > 0) {
      if (!isStorageConfigured()) {
        return res.status(503).json({ error: 'Attachments are not available right now.' });
      }
      // Confirms the browser actually finished the direct-to-R2 upload
      // (and that what landed there matches what was declared) before any
      // MessageAttachment row is created — an authorized-but-never-uploaded
      // storage key can never become a visible attachment this way.
      for (const a of attachmentDescriptors) {
        const head = await headObject({ storageKey: a.storageKey });
        if (!head || head.contentLength !== a.byteSize || (head.contentType && head.contentType !== a.mimeType)) {
          return res.status(400).json({ error: 'Attachment upload could not be verified.' });
        }
      }
    }

    const conversation = await getOrCreateConversation(communityId);

    // A reply must point at a message in THIS same group chat.
    const replyToMessageId = parsed.data.replyToMessageId ?? null;
    if (replyToMessageId) {
      const original = await prisma.message.findUnique({ where: { id: replyToMessageId }, select: { conversationId: true } });
      if (!original || original.conversationId !== conversation.id) {
        return res.status(400).json({ error: 'Invalid reply reference.' });
      }
    }

    const created = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderPersonId: personId,
        replyToMessageId,
        body: parsed.data.body && parsed.data.body.length > 0 ? parsed.data.body : null,
        liveTeaching,
        attachments: attachmentDescriptors.length
          ? {
              create: attachmentDescriptors.map((a) => ({
                language: a.language ?? null,
                storageKey: a.storageKey,
                originalFilename: a.originalFilename,
                mimeType: a.mimeType,
                byteSize: a.byteSize,
                thumbDataUrl: a.thumb ?? null,
                pageCount: a.pageCount ?? null,
                uploadedByPersonId: personId,
              })),
            }
          : undefined,
      },
      include: {
        attachments: { select: { id: true, originalFilename: true, mimeType: true, byteSize: true } },
        replyTo: replyToInclude,
      },
    });

    // Phase 5 — best-effort push to every other ACTIVE member of this
    // group, so the message reaches a closed app, not just an open one.
    // Deliberately NOT a Notification row per member — that would flood
    // the bell with one entry per chat message; the chat's own unread
    // badge (and the message itself, once opened) already covers in-app
    // awareness, so push is the only thing closed-app delivery needs here.
    // Fire-and-forget: never delays or can fail the message-send response.
    void (async () => {
      const [sender, community, recipients] = await Promise.all([
        prisma.person.findUnique({ where: { id: personId }, select: { name: true } }),
        prisma.community.findUnique({ where: { id: communityId }, select: { name: true } }),
        prisma.communityMembership.findMany({
          where: { communityId, status: 'ACTIVE', personId: { not: personId } },
          select: { personId: true },
        }),
      ]);
      const hasVoice = attachmentDescriptors.some((a) => a.mimeType.startsWith('audio/'));
      // Said the same way to everyone, in both languages, since a notification can't know who reads it.
      const preview = liveTeaching
        ? `🔴 Live teaching · Enseignement en direct${labelled ? ' (EN + FR)' : ''}`
        : (created.body ?? (hasVoice ? `🎙️ Voice message${labelled ? ' (EN + FR)' : ''}` : attachmentDescriptors.length > 0 ? '📎 Attachment' : ''));
      await pushToPersons(recipients.map((r) => r.personId), {
        title: `${sender?.name ?? 'Someone'} • ${community?.name ?? 'Group'}`,
        body: preview.length > 120 ? `${preview.slice(0, 120)}…` : preview,
        url: `/member/chats/group/${communityId}`,
      });
    })().catch(() => {});

    // Auto-translation — fire-and-forget, same rule as the push block just
    // above: never delays or can fail the message-send response. A text
    // body gets translated; a voice-note attachment gets transcribed (and
    // its transcript translated) — never both calls for the same message in
    // practice (a voice note's `body` is empty), but nothing stops it if it
    // ever is.
    if (created.body) {
      void translateAndStoreMessage(created.id, created.body).catch(() => {});
    }
    // A two-language recording is already in both languages: nothing to transcribe or translate.
    const audioAttachment = labelled ? undefined : attachmentDescriptors.find((a) => a.mimeType.startsWith('audio/'));
    if (audioAttachment) {
      void transcribeAndStoreMessageAudio(created.id, audioAttachment.storageKey, audioAttachment.mimeType).catch(() => {});
    }

    res.status(201).json({
      id: created.id,
      body: created.body,
      createdAt: created.createdAt,
      attachments: created.attachments,
      replyTo: replyPreview(created.replyTo),
    });
  }),
);

// POST /api/communities/:communityId/attachments/authorize — Step 1 of the
// direct-to-R2 upload lifecycle. Validates the caller's own Community
// access, the declared MIME type/size/filename against attachmentPolicy's
// allow-list, and returns a short-lived presigned PUT URL plus a
// server-generated, opaque storage key (never a client-supplied path).
// Nothing is persisted here — no row is created until the message that
// finalizes this attachment is actually sent (see the message-creation
// route above), so an authorized-but-abandoned upload can never become a
// visible attachment purely by calling this route.
const authorizeAttachmentSchema = z.object({
  originalFilename: z.string().trim().min(1).max(MAX_ORIGINAL_FILENAME_LENGTH),
  mimeType: z.string().min(1),
  byteSize: z.number().int().positive(),
});

router.post(
  '/:communityId/attachments/authorize',
  attachmentUploadAuthorizeLimiter,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const { communityId } = req.params;

    if (!(await contextTargetExists('COMMUNITY', communityId))) {
      return res.status(404).json({ error: 'Community not found.' });
    }

    const personId = req.conversationActorPersonId!;
    if (!(await hasConversationAccess(personId, communityId))) {
      return res.status(403).json({ error: 'You do not have access to this community\'s conversation.' });
    }

    const parsed = authorizeAttachmentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid attachment request.' });
    }
    const { originalFilename, mimeType, byteSize } = parsed.data;

    if (!isAllowedAttachmentMime(mimeType)) {
      return res.status(400).json({ error: 'Unsupported attachment type.' });
    }
    const maxBytes = maxBytesForMime(mimeType)!;
    if (byteSize > maxBytes) {
      return res.status(400).json({ error: 'Attachment is too large.' });
    }
    if (!isValidOriginalFilename(originalFilename)) {
      return res.status(400).json({ error: 'Invalid attachment filename.' });
    }

    if (!isStorageConfigured()) {
      return res.status(503).json({ error: 'Attachments are not available right now.' });
    }

    const storageKey = generateStorageKey(communityId);
    const { url, expiresAt } = await createUploadUrl({ storageKey, mimeType });

    res.json({ storageKey, uploadUrl: url, expiresAt, maxBytes });
  }),
);

const markReadSchema = z.object({
  messageId: z.string().min(1),
});

// POST /api/communities/:communityId/conversation/read — advances the
// caller's own read cursor to the given message's createdAt. `messageId` is
// validated to belong to THIS conversation (same pattern as the `before`
// pagination cursor above) — never a raw client-supplied timestamp, and
// never another Person's id. Idempotent; never moves the cursor backwards
// (see markCommunityConversationRead). Read state never grants access: the
// same contextTargetExists / hasConversationAccess checks run first, exactly
// as every other route in this file.
router.post(
  '/:communityId/conversation/read',
  communityConversationReadLimiter,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const { communityId } = req.params;

    if (!(await contextTargetExists('COMMUNITY', communityId))) {
      return res.status(404).json({ error: 'Community not found.' });
    }

    const personId = req.conversationActorPersonId!;
    if (!(await hasConversationAccess(personId, communityId))) {
      return res.status(403).json({ error: 'You do not have access to this community\'s conversation.' });
    }

    const parsed = markReadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'A messageId is required.' });
    }

    const conversation = await getOrCreateConversation(communityId);

    const message = await prisma.message.findUnique({ where: { id: parsed.data.messageId } });
    if (!message || message.conversationId !== conversation.id) {
      return res.status(400).json({ error: 'Invalid message reference.' });
    }

    await markCommunityConversationRead(personId, conversation.id, message.createdAt);
    const unreadCount = await getCommunityConversationUnreadCount(personId, conversation.id, communityId);

    res.json({ unreadCount });
  }),
);

// DELETE /api/communities/:communityId/conversation/messages/:messageId —
// Phase 3M.8A moderation. Only an active Community Administrator for this
// EXACT Community (isCommunityAdministrator — an ACTIVE SCOPED_LEADER
// RoleAssignment for communityId itself, never a parent/child/geography
// scope) may remove a message. This is reachable through the same shared
// requireConversationActor middleware as every other route in this file
// (Member or Leader session), because authority here belongs to the acting
// Person, not to which session they happen to be using — the same
// shared-identity precedent already established by Phase 3M.7's read state.
// An ordinary Member or a Leader without this exact role is rejected by
// isCommunityAdministrator itself, never by the session type.
//
// Soft delete only: deletedAt/deletedByPersonId are set, the row and its
// original body are never removed — see the Message model's own schema
// comment. Idempotent: deleting an already-deleted message is a safe no-op,
// not an error.
router.delete(
  '/:communityId/conversation/messages/:messageId',
  communityModerationLimiter,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const { communityId, messageId } = req.params;

    if (!(await contextTargetExists('COMMUNITY', communityId))) {
      return res.status(404).json({ error: 'Community not found.' });
    }

    const personId = req.conversationActorPersonId!;
    if (!(await isCommunityAdministrator(personId, communityId))) {
      return res.status(403).json({ error: 'Only an active Community Administrator may remove a message.' });
    }

    const conversation = await getOrCreateConversation(communityId);

    // Validated to belong to THIS exact conversation — the same
    // never-trust-a-bare-id pattern already used for the pagination cursor
    // and the read-state messageId above, so a message id from a different
    // Community's conversation can never be moderated via this route.
    const message = await prisma.message.findUnique({ where: { id: messageId } });
    if (!message || message.conversationId !== conversation.id) {
      return res.status(404).json({ error: 'Message not found.' });
    }

    if (!message.deletedAt) {
      await prisma.message.update({
        where: { id: messageId },
        data: { deletedAt: new Date(), deletedByPersonId: personId },
      });

      await recordAudit({
        actorId: req.user?.id ?? null,
        actorEmail: req.user?.email ?? null,
        action: 'COMMUNITY_MESSAGE_DELETED',
        targetType: 'Message',
        targetId: messageId,
        metadata: { communityId, conversationId: conversation.id, deletedByPersonId: personId },
      });
    }

    res.json({ id: messageId, deleted: true });
  }),
);

// PUT /api/communities/:communityId/conversation/messages/:messageId/reaction
// { emoji } — set (or change) the caller's own reaction. DELETE removes it.
// Anyone who can read the group chat may react; removed messages can't be
// reacted to.
const reactionSchema = z.object({ emoji: z.enum(ALLOWED_REACTIONS) });

async function loadReactableMessage(req: Request, res: Response) {
  const { communityId, messageId } = req.params;
  if (!(await contextTargetExists('COMMUNITY', communityId))) {
    res.status(404).json({ error: 'Community not found.' });
    return null;
  }
  const personId = req.conversationActorPersonId!;
  if (!(await hasConversationAccess(personId, communityId))) {
    res.status(403).json({ error: 'You do not have access to this community\'s conversation.' });
    return null;
  }
  const conversation = await getOrCreateConversation(communityId);
  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message || message.conversationId !== conversation.id || message.deletedAt) {
    res.status(404).json({ error: 'Message not found.' });
    return null;
  }
  const hidden = await prisma.messageHiddenForPerson.findUnique({
    where: { messageId_personId: { messageId, personId } },
  });
  if (hidden) {
    res.status(404).json({ error: 'Message not found.' });
    return null;
  }
  return { personId, messageId };
}

async function reactionsFor(messageId: string, personId: string) {
  const rows = await prisma.messageReaction.findMany({ where: { messageId }, select: { emoji: true, personId: true } });
  return summarizeReactions(rows, personId);
}

// GET .../conversation/messages/:messageId/reactions — who reacted, and with what.
router.get('/:communityId/conversation/messages/:messageId/reactions', asyncHandler(async (req, res) => {
  const target = await loadReactableMessage(req, res);
  if (!target) return;
  const rows = await prisma.messageReaction.findMany({ where: { messageId: target.messageId }, select: { personId: true, emoji: true, createdAt: true } });
  const list = await reactorList(rows.map((r) => ({ personId: r.personId, reaction: r.emoji, createdAt: r.createdAt })), { personId: target.personId });
  res.json({ ...list, reactions: summarizeReactions(rows, target.personId) });
}));

router.put(
  '/:communityId/conversation/messages/:messageId/reaction',
  messageReactionLimiter,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const target = await loadReactableMessage(req, res);
    if (!target) return;
    const parsed = reactionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Unsupported reaction.' });
    }
    await prisma.messageReaction.upsert({
      where: { messageId_personId: { messageId: target.messageId, personId: target.personId } },
      create: { messageId: target.messageId, personId: target.personId, emoji: parsed.data.emoji },
      update: { emoji: parsed.data.emoji },
    });
    res.json({ reactions: await reactionsFor(target.messageId, target.personId) });
  }),
);

router.delete(
  '/:communityId/conversation/messages/:messageId/reaction',
  messageReactionLimiter,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const target = await loadReactableMessage(req, res);
    if (!target) return;
    await prisma.messageReaction.deleteMany({ where: { messageId: target.messageId, personId: target.personId } });
    res.json({ reactions: await reactionsFor(target.messageId, target.personId) });
  }),
);

// GET /api/communities/:communityId/conversation/members — the group info
// page: everyone in the group (leaders first, then who is online), with a
// green dot for those online now.
router.get('/:communityId/conversation/members', asyncHandler(async (req, res) => {
  const { communityId } = req.params;
  if (!(await contextTargetExists('COMMUNITY', communityId))) {
    return res.status(404).json({ error: 'Community not found.' });
  }
  const personId = req.conversationActorPersonId!;
  if (!(await hasConversationAccess(personId, communityId))) {
    return res.status(403).json({ error: 'You do not have access to this community\'s conversation.' });
  }
  const [audience, leaders] = await Promise.all([
    communityAudience(communityId),
    prisma.roleAssignment.findMany({
      where: { communityId, roleType: 'SCOPED_LEADER', status: 'ACTIVE' },
      select: { personId: true },
    }),
  ]);
  const leaderIds = new Set(leaders.map((l) => l.personId));
  const now = Date.now();
  const members = audience
    .map((a) => ({
      personId: a.personId,
      name: a.name,
      photoUrl: a.photoUrl,
      isLeader: leaderIds.has(a.personId),
      isYou: a.personId === personId,
      online: a.personId === personId || isOnline(a.lastSeenAt, now),
    }))
    .sort((x, y) => Number(y.isLeader) - Number(x.isLeader) || Number(y.online) - Number(x.online) || x.name.localeCompare(y.name));
  res.json({ members, memberCount: members.length, onlineCount: members.filter((m) => m.online).length });
}));

// GET .../conversation/messages/:messageId/info — "Message info" for the
// sender's OWN message: who has seen it and who has received it.
router.get('/:communityId/conversation/messages/:messageId/info', asyncHandler(async (req, res) => {
  const { communityId, messageId } = req.params;
  if (!(await contextTargetExists('COMMUNITY', communityId))) {
    return res.status(404).json({ error: 'Community not found.' });
  }
  const personId = req.conversationActorPersonId!;
  if (!(await hasConversationAccess(personId, communityId))) {
    return res.status(403).json({ error: 'You do not have access to this community\'s conversation.' });
  }
  const conversation = await getOrCreateConversation(communityId);
  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message || message.conversationId !== conversation.id) {
    return res.status(404).json({ error: 'Message not found.' });
  }
  if (message.senderPersonId !== personId) {
    return res.status(403).json({ error: 'You can only see info for your own messages.' });
  }
  const [audience, reads] = await Promise.all([
    communityAudience(communityId),
    prisma.communityConversationRead.findMany({ where: { conversationId: conversation.id }, select: { personId: true, lastReadAt: true } }),
  ]);
  const receipt = groupMessageReceipt(message, audience, new Map(reads.map((r) => [r.personId, r.lastReadAt])));
  const readIds = new Set(receipt.readBy.map((p) => p.personId));
  const person = (p: { personId: string; name: string; photoUrl: string | null }) => ({ personId: p.personId, name: p.name, photoUrl: p.photoUrl });
  res.json({
    status: receipt.status,
    total: receipt.total,
    readBy: receipt.readBy.map(person),
    deliveredTo: receipt.deliveredTo.filter((p) => !readIds.has(p.personId)).map(person),
  });
}));

// POST .../conversation/typing { typing: true|false } — shows "Ada is
// typing…" to the others for a few seconds.
router.post(
  '/:communityId/conversation/typing',
  typingLimiter,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const { communityId } = req.params;
    if (!(await contextTargetExists('COMMUNITY', communityId))) {
      return res.status(404).json({ error: 'Community not found.' });
    }
    const personId = req.conversationActorPersonId!;
    if (!(await canPostCommunityMessage(personId, communityId))) {
      return res.status(403).json({ error: 'You do not have permission to post in this community.' });
    }
    const conversation = await getOrCreateConversation(communityId);
    const key = `group:${conversation.id}`;
    if (req.body?.typing === false) {
      clearTyping(key, personId);
    } else {
      const me = await prisma.person.findUnique({ where: { id: personId }, select: { name: true } });
      // { recording: true } = "is recording a voice message…"; live only counts for the central admin.
      const recording = req.body?.recording === true;
      const live = recording && req.body?.live === true && (await isCentralAdminPerson(personId));
      setTyping(key, personId, me?.name ?? '', { recording, live });
    }
    res.json({ ok: true });
  }),
);

// POST /api/communities/:communityId/conversation/messages/:messageId/hide
// — Phase 3M.8C "delete for me". Deliberately restricted to a Person's OWN
// messages only (message.senderPersonId !== personId is rejected below) —
// this is a sender retracting their own message from their own view, never
// a way to hide someone else's message. Never touches
// deletedAt/deletedByPersonId, never records a COMMUNITY_MESSAGE_DELETED (or
// any other) audit event — see MessageHiddenForPerson's own schema comment.
// Idempotent via hideMessageForPerson's upsert.
router.post(
  '/:communityId/conversation/messages/:messageId/hide',
  messageHideLimiter,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const { communityId, messageId } = req.params;

    if (!(await contextTargetExists('COMMUNITY', communityId))) {
      return res.status(404).json({ error: 'Community not found.' });
    }

    const personId = req.conversationActorPersonId!;
    if (!(await hasConversationAccess(personId, communityId))) {
      return res.status(403).json({ error: 'You do not have access to this community\'s conversation.' });
    }

    const conversation = await getOrCreateConversation(communityId);

    // Validated to belong to THIS exact conversation — same never-trust-a-
    // bare-id pattern as every other messageId in this file.
    const message = await prisma.message.findUnique({ where: { id: messageId } });
    if (!message || message.conversationId !== conversation.id) {
      return res.status(404).json({ error: 'Message not found.' });
    }

    if (message.senderPersonId !== personId) {
      return res.status(403).json({ error: 'You may only hide your own messages.' });
    }

    await hideMessageForPerson(personId, messageId);

    res.json({ id: messageId, hidden: true });
  }),
);

// GET /api/communities/:communityId/conversation/messages/:messageId/attachments/:attachmentId/download-url
// — Phase 3M.8C. The client supplies only an attachmentId; the server
// resolves attachment -> message -> conversation -> Community and re-runs
// the same hasConversationAccess check as every other route here, never
// trusting a client-supplied storage key or URL. A deleted (moderator) or
// personally-hidden message's attachment is treated as not found for an
// ordinary participant — Central Authority's separate, reason-gated
// oversight route (adminConversationOversight.ts) is the only path that can
// still reach it. Mints a fresh, short-lived signed URL on every call —
// never persisted, never cached.
router.get(
  '/:communityId/conversation/messages/:messageId/attachments/:attachmentId/download-url',
  attachmentDownloadLimiter,
  asyncHandler(async (req, res) => {
    const { communityId, messageId, attachmentId } = req.params;

    if (!(await contextTargetExists('COMMUNITY', communityId))) {
      return res.status(404).json({ error: 'Community not found.' });
    }

    const personId = req.conversationActorPersonId!;
    if (!(await hasConversationAccess(personId, communityId))) {
      return res.status(403).json({ error: 'You do not have access to this community\'s conversation.' });
    }

    const conversation = await getOrCreateConversation(communityId);

    const message = await prisma.message.findUnique({ where: { id: messageId } });
    if (!message || message.conversationId !== conversation.id) {
      return res.status(404).json({ error: 'Attachment not found.' });
    }
    if (message.deletedAt) {
      return res.status(404).json({ error: 'Attachment not found.' });
    }

    const hidden = await prisma.messageHiddenForPerson.findUnique({
      where: { messageId_personId: { messageId, personId } },
    });
    if (hidden) {
      return res.status(404).json({ error: 'Attachment not found.' });
    }

    const attachment = await prisma.messageAttachment.findUnique({ where: { id: attachmentId } });
    if (!attachment || attachment.messageId !== message.id) {
      return res.status(404).json({ error: 'Attachment not found.' });
    }

    if (!isStorageConfigured()) {
      return res.status(503).json({ error: 'Attachments are not available right now.' });
    }

    const { url, expiresAt } = await createDownloadUrl({ storageKey: attachment.storageKey });
    res.json({ url, expiresAt });
  }),
);

// ── WhatsApp actions: delete for everyone, edit, search ────────────────

async function loadOwnGroupMessage(req: Request, res: Response) {
  const { communityId, messageId } = req.params;
  if (!(await contextTargetExists('COMMUNITY', communityId))) {
    res.status(404).json({ error: 'Community not found.' });
    return null;
  }
  const personId = req.conversationActorPersonId!;
  if (!(await hasConversationAccess(personId, communityId))) {
    res.status(403).json({ error: 'You do not have access to this community\'s conversation.' });
    return null;
  }
  const conversation = await getOrCreateConversation(communityId);
  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message || message.conversationId !== conversation.id) {
    res.status(404).json({ error: 'Message not found.' });
    return null;
  }
  if (message.senderPersonId !== personId) {
    res.status(403).json({ error: 'You can only change your own messages.' });
    return null;
  }
  return { personId, communityId, conversation, message };
}

// POST .../conversation/messages/:messageId/unsend — "Delete for everyone".
// The sender's OWN message only, within 2 days (like WhatsApp). Everyone
// then sees "This message was deleted". Soft delete like moderation: the
// row is kept for Central Authority oversight, never shown to members.
router.post(
  '/:communityId/conversation/messages/:messageId/unsend',
  messageHideLimiter,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const target = await loadOwnGroupMessage(req, res);
    if (!target) return;
    const { message, personId, communityId, conversation } = target;
    if (!message.deletedAt) {
      if (Date.now() - message.createdAt.getTime() > UNSEND_WINDOW_MS) {
        return res.status(400).json({ error: 'This message is too old to delete for everyone.' });
      }
      await prisma.message.update({ where: { id: message.id }, data: { deletedAt: new Date(), deletedByPersonId: personId } });
      await prisma.messageReaction.deleteMany({ where: { messageId: message.id } });
      await recordAudit({
        actorId: req.user?.id ?? null,
        actorEmail: req.user?.email ?? null,
        action: 'COMMUNITY_MESSAGE_UNSENT',
        targetType: 'Message',
        targetId: message.id,
        metadata: { communityId, conversationId: conversation.id, personId },
      });
    }
    res.json({ id: message.id, deleted: true, deletedBySender: true });
  }),
);

// PATCH .../conversation/messages/:messageId { body } — edit your own text
// within 15 minutes (like WhatsApp). Shows "edited" next to the time.
router.patch(
  '/:communityId/conversation/messages/:messageId',
  messageSendLimiter,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const target = await loadOwnGroupMessage(req, res);
    if (!target) return;
    const { message, personId, communityId } = target;
    if (message.deletedAt) return res.status(404).json({ error: 'Message not found.' });
    if (!(await canPostCommunityMessage(personId, communityId))) {
      return res.status(403).json({ error: 'You do not have permission to post in this community.' });
    }
    if (!message.body) return res.status(400).json({ error: 'Only text can be edited.' });
    if (Date.now() - message.createdAt.getTime() > EDIT_WINDOW_MS) {
      return res.status(400).json({ error: 'This message is too old to edit.' });
    }
    const parsed = editMessageSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid message.' });
    const updated = await prisma.message.update({
      where: { id: message.id },
      data: { body: parsed.data.body, editedAt: new Date() },
    });
    res.json({ id: updated.id, body: updated.body, edited: true, editedAt: updated.editedAt });
  }),
);

// GET .../conversation/search?q=word — find messages in this group (newest
// first, up to 30). Never searches removed or hidden messages.
router.get('/:communityId/conversation/search', chatSearchLimiter, asyncHandler(async (req, res) => {
  const { communityId } = req.params;
  if (!(await contextTargetExists('COMMUNITY', communityId))) {
    return res.status(404).json({ error: 'Community not found.' });
  }
  const personId = req.conversationActorPersonId!;
  if (!(await hasConversationAccess(personId, communityId))) {
    return res.status(403).json({ error: 'You do not have access to this community\'s conversation.' });
  }
  const parsed = searchQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Type at least 2 letters.' });
  const conversation = await getOrCreateConversation(communityId);
  const cutoff = await historyCutoffFor(personId, communityId, conversation.id);
  const rows = await prisma.message.findMany({
    where: {
      conversationId: conversation.id,
      deletedAt: null,
      body: { contains: parsed.data.q, mode: 'insensitive' },
      NOT: { hiddenFor: { some: { personId } } },
      ...(cutoff ? { createdAt: { gte: cutoff } } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 30,
    select: { id: true, body: true, createdAt: true, senderPersonId: true, sender: { select: { name: true } } },
  });
  res.json({
    items: rows.map((m) => ({ id: m.id, senderName: m.sender.name, isOwn: m.senderPersonId === personId, body: m.body, createdAt: m.createdAt })),
  });
}));

export default router;
