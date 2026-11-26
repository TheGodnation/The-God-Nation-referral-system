import { prisma } from './prisma';
import { embedFor, type SocialProvider } from './socialEmbed';
import { excerpt } from './ogMeta';
import { isCentralAdminPerson } from './centralAdmin';
import { attemptUpdatePostTranslation, translateBeforePublish } from './translation';
import { isPhotoResizingAvailable, MAX_INPUT_BYTES } from './photoCard';

// Sharing the central admin's posts and announcements by link. Nothing is public until the central admin taps "Share by
// link" on that post (it then carries sharedPublicAt); only published, not archived items can be shared, and the public
// can read only the words and title, never the photos or videos, comments, or who reacted. "Stop sharing" closes the link.

export type SharedKind = 'post' | 'announcement' | 'update';
export const isSharedKind = (k: string): k is SharedKind => k === 'post' || k === 'announcement' || k === 'update';
export const sharePath = (kind: SharedKind, id: string) => `/news/${kind}/${id}`;

class ShareError extends Error {
  constructor(message: string, public status = 400, public code?: string) {
    super(message);
  }
}
export { ShareError };

/** A member's own post in the Updates wall: shareable only when written by the central admin, for everyone, and not deleted. */
async function loadUpdate(id: string) {
  const u = await prisma.updatePost.findUnique({ where: { id }, select: { id: true, createdAt: true, deletedAt: true, sharedPublicAt: true, authorPersonId: true, audience: true } });
  if (!u) return null;
  const eligible = u.audience === 'EVERYONE' && (await isCentralAdminPerson(u.authorPersonId));
  return { id: u.id, publishedAt: eligible ? u.createdAt : null, archivedAt: u.deletedAt, sharedPublicAt: u.sharedPublicAt };
}

async function loadAny(kind: SharedKind, id: string) {
  if (kind === 'update') return loadUpdate(id);
  if (kind === 'post') return prisma.headquartersPost.findUnique({ where: { id }, select: { id: true, publishedAt: true, archivedAt: true, sharedPublicAt: true } });
  return prisma.announcement.findUnique({ where: { id }, select: { id: true, publishedAt: true, archivedAt: true, sharedPublicAt: true } });
}

/** Opens the link for this post or announcement (idempotent). Only a published, not archived one can be shared. */
export async function shareByLink(kind: SharedKind, id: string) {
  const row = await loadAny(kind, id);
  if (!row) throw new ShareError('Not found.', 404);
  if (!row.publishedAt || row.archivedAt) throw new ShareError('Only a published post can be shared by link.', 409, 'NOT_PUBLISHED');
  if (!row.sharedPublicAt) {
    const data = { sharedPublicAt: new Date() };
    if (kind === 'post') await prisma.headquartersPost.update({ where: { id }, data });
    else if (kind === 'update') await prisma.updatePost.update({ where: { id }, data });
    else await prisma.announcement.update({ where: { id }, data });
  }
  await ensureFrench(kind, id);
  return { kind, id, shared: true, path: sharePath(kind, id) };
}

/**
 * So the French message and the French page are really in French: when the post has no French yet, translate it now (a few seconds
 * at most; if that fails, sharing still works and the page falls back to the original words).
 */
async function ensureFrench(kind: SharedKind, id: string): Promise<void> {
  try {
    if (kind === 'update') {
      const u = await prisma.updatePost.findUnique({ where: { id }, select: { body: true, translatedBody: true } });
      if (u && !u.translatedBody && u.body.trim()) await Promise.race([attemptUpdatePostTranslation(id, u.body), new Promise((resolve) => setTimeout(resolve, 20000))]);
    } else {
      await translateBeforePublish(kind === 'post' ? 'HEADQUARTERS_POST' : 'ANNOUNCEMENT', id, 20000);
    }
  } catch {
    // best effort
  }
}

export async function stopSharing(kind: SharedKind, id: string) {
  const row = await loadAny(kind, id);
  if (!row) throw new ShareError('Not found.', 404);
  if (row.sharedPublicAt) {
    if (kind === 'post') await prisma.headquartersPost.update({ where: { id }, data: { sharedPublicAt: null } });
    else if (kind === 'update') await prisma.updatePost.update({ where: { id }, data: { sharedPublicAt: null } });
    else await prisma.announcement.update({ where: { id }, data: { sharedPublicAt: null } });
  }
  return { kind, id, shared: false, path: sharePath(kind, id) };
}

export async function shareState(kind: SharedKind, id: string) {
  const row = await loadAny(kind, id);
  if (!row) throw new ShareError('Not found.', 404);
  return { kind, id, shared: Boolean(row.sharedPublicAt), path: sharePath(kind, id) };
}

const visible = { publishedAt: { not: null }, archivedAt: null, sharedPublicAt: { not: null } } as const;

/** What anyone with the link may read. Null when the link is closed, the post is archived, or it does not exist. */
export async function publicItem(kind: SharedKind, id: string) {
  if (kind === 'update') {
    const u = await prisma.updatePost.findFirst({
      where: { id, deletedAt: null, audience: 'EVERYONE', sharedPublicAt: { not: null } },
      include: { author: { select: { id: true, name: true } }, _count: { select: { photos: true } } },
    });
    if (!u || !(await isCentralAdminPerson(u.author.id))) return null; // the author must still be the central admin
    // The post is in one language; the other comes from the stored tap-to-translate text when there is one.
    const other = u.translatedBody || u.body;
    const fr = u.detectedLanguage === 'fr' ? u.body : other;
    const en = u.detectedLanguage === 'fr' ? other : u.body;
    const headline = (text: string) => excerpt(text.split('\n').find((l) => l.trim()) ?? text, 90);
    return {
      kind,
      id: u.id,
      title: { en: headline(en), fr: headline(fr) },
      body: { en: withoutTitle(headline(en), en), fr: withoutTitle(headline(fr), fr) },
      author: u.author.name,
      publishedAt: u.createdAt,
      mediaCount: u._count.photos,
      embed: u.youtubeVideoId ? embedFor('YOUTUBE', `https://www.youtube.com/watch?v=${u.youtubeVideoId}`) : null,
    };
  }
  if (kind === 'post') {
    const p = await prisma.headquartersPost.findFirst({
      where: { id, ...visible },
      include: { authorPerson: { select: { name: true } }, _count: { select: { media: true } } },
    });
    if (!p) return null;
    return {
      kind,
      id: p.id,
      title: { en: p.titleEn, fr: p.titleFr || p.titleEn },
      body: { en: withoutTitle(p.titleEn, p.bodyEn), fr: withoutTitle(p.titleFr || p.titleEn, p.bodyFr || p.bodyEn) },
      author: p.authorPerson?.name ?? (p.voice === 'COMMUNICATION_DEPARTMENT' ? 'The God Nation — Communication Department' : 'The God Nation'),
      publishedAt: p.publishedAt,
      mediaCount: p._count.media,
      embed: embedFor((p.linkProvider ?? null) as SocialProvider | null, p.linkUrl ?? null),
    };
  }
  const a = await prisma.announcement.findFirst({ where: { id, ...visible }, include: { authorPerson: { select: { name: true } } } });
  if (!a) return null;
  return {
    kind,
    id: a.id,
    title: { en: a.titleEn, fr: a.titleFr || a.titleEn },
    body: { en: withoutTitle(a.titleEn, a.bodyEn), fr: withoutTitle(a.titleFr || a.titleEn, a.bodyFr || a.bodyEn) },
    author: a.authorPerson?.name ?? 'The God Nation',
    publishedAt: a.publishedAt,
    mediaCount: 0,
    embed: null,
  };
}

/** The other shared posts and announcements, newest first, to invite people to read on (and so to join). */
export async function moreShared(exclude: { kind: SharedKind; id: string }, limit = 5) {
  const [posts, announcements, updates] = await Promise.all([
    prisma.headquartersPost.findMany({ where: { ...visible, NOT: exclude.kind === 'post' ? { id: exclude.id } : undefined }, orderBy: { publishedAt: 'desc' }, take: limit, select: { id: true, titleEn: true, titleFr: true, publishedAt: true } }),
    prisma.announcement.findMany({ where: { ...visible, NOT: exclude.kind === 'announcement' ? { id: exclude.id } : undefined }, orderBy: { publishedAt: 'desc' }, take: limit, select: { id: true, titleEn: true, titleFr: true, publishedAt: true } }),
    prisma.updatePost.findMany({ where: { deletedAt: null, audience: 'EVERYONE', sharedPublicAt: { not: null }, NOT: exclude.kind === 'update' ? { id: exclude.id } : undefined }, orderBy: { createdAt: 'desc' }, take: limit, select: { id: true, body: true, createdAt: true, authorPersonId: true } }),
  ]);
  const admins = await Promise.all(updates.map((u) => isCentralAdminPerson(u.authorPersonId)));
  const updateRows = updates.filter((_, i) => admins[i]).map((u) => {
    const line = excerpt(u.body.split('\n').find((l) => l.trim()) ?? u.body, 90);
    return { kind: 'update' as const, id: u.id, title: { en: line, fr: line }, publishedAt: u.createdAt as Date | null };
  });
  return [
    ...posts.map((p) => ({ kind: 'post' as const, id: p.id, title: { en: p.titleEn, fr: p.titleFr || p.titleEn }, publishedAt: p.publishedAt })),
    ...announcements.map((a) => ({ kind: 'announcement' as const, id: a.id, title: { en: a.titleEn, fr: a.titleFr || a.titleEn }, publishedAt: a.publishedAt })),
    ...updateRows,
  ]
    .sort((x, y) => (y.publishedAt?.getTime() ?? 0) - (x.publishedAt?.getTime() ?? 0))
    .slice(0, limit);
}

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
/** Above this a picture is not used on the link card (Facebook skips very large ones; WhatsApp's own, smaller limit is applied where the card is built). */
export const CARD_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

export interface SharedPhoto {
  storageKey: string;
  mimeType: string;
  byteSize: number;
}

/** The pictures of a shared post, in order. Empty when the link is closed, there are none, or the item is an announcement. */
export async function sharedPhotos(kind: SharedKind, id: string): Promise<SharedPhoto[]> {
  if (!(await publicItem(kind, id))) return [];
  const rows =
    kind === 'post'
      ? await prisma.headquartersPostMedia.findMany({ where: { headquartersPostId: id, mediaType: 'IMAGE' }, orderBy: { position: 'asc' }, select: { storageKey: true, mimeType: true, byteSize: true }, take: 8 })
      : kind === 'update'
        ? await prisma.updatePostPhoto.findMany({ where: { postId: id }, orderBy: { position: 'asc' }, select: { storageKey: true, mimeType: true, byteSize: true }, take: 8 })
        : [];
  return rows.filter((r) => IMAGE_TYPES.has(r.mimeType.toLowerCase()));
}

/** The path (under the site address) of the picture for a link card, or null: then the usual card stays. */
export async function cardImagePath(kind: SharedKind, id: string): Promise<string | null> {
  return (await cardImage(kind, id))?.path ?? null;
}

async function cardImage(kind: SharedKind, id: string): Promise<{ path: string; bytes: number } | null> {
  const first = (await sharedPhotos(kind, id))[0];
  if (!first) return null;
  // With the image tool, any picture is fitted whole into 1200x630 and kept small, so every size works (bytes: what WhatsApp will
  // fetch). "?v=whole": a new address for the new kind of card, so Facebook and WhatsApp do not keep showing an old, cut-off one.
  if (first.byteSize <= MAX_INPUT_BYTES && (await isPhotoResizingAvailable())) return { path: `api/shared/${kind}/${id}/card.jpg?v=whole`, bytes: 0 };
  // Without it, only a picture of a size the apps accept is used, as it is.
  return first.byteSize <= CARD_PHOTO_MAX_BYTES ? { path: `api/shared/${kind}/${id}/photo/0`, bytes: first.byteSize } : null;
}

const markless = (t: string) => t.replace(/^\s{0,3}#{1,6}\s*/, '').replace(/[*_~`#]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** The writing without its first line when that line only says the title again (the page already shows the title above it). */
export function withoutTitle(title: string, body: string): string {
  const lines = body.split('\n');
  const first = lines.findIndex((l) => l.trim() !== '');
  if (first < 0) return body;
  const head = markless(title).replace(/…$/, '');
  if (head && markless(lines[first]) === head) return lines.slice(first + 1).join('\n').replace(/^\s*\n+/, '');
  return body;
}

/** The post's writing as plain sentences for a link card: no ## / ** marks, and not starting with its own heading again. */
export function previewText(title: string, body: string): string {
  const clean = (t: string) => t.replace(/^\s{0,3}#{1,6}\s*/, '').replace(/^\s*[-•]\s+/, '').replace(/[*_~`#]/g, '').replace(/\s+/g, ' ').trim();
  const head = clean(title);
  let text = body.split('\n').map(clean).filter(Boolean).join(' ');
  if (head && text.toLowerCase().startsWith(head.toLowerCase())) text = text.slice(head.length).replace(/^[\s:.\-–—]+/, '');
  return text;
}

/** For the link preview (WhatsApp, Facebook...): the title and the first lines, in the link's language. Null when the link is closed. */
export async function sharedPreview(kind: SharedKind, id: string, lang: 'en' | 'fr'): Promise<{ title: string; text: string; image: string | null; imageBytes: number | null } | null> {
  const item = await publicItem(kind, id);
  if (!item) return null;
  const image = await cardImage(kind, id);
  return { title: item.title[lang], text: excerpt(previewText(item.title[lang], item.body[lang])), image: image?.path ?? null, imageBytes: image?.bytes ?? null };
}
