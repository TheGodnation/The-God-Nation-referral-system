import { prisma } from './prisma';
import { embedFor, type SocialProvider } from './socialEmbed';
import { excerpt } from './ogMeta';
import { isCentralAdminPerson } from './centralAdmin';

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
  return { kind, id, shared: true, path: sharePath(kind, id) };
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
      body: { en, fr },
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
      body: { en: p.bodyEn, fr: p.bodyFr || p.bodyEn },
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
    body: { en: a.bodyEn, fr: a.bodyFr || a.bodyEn },
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

/** For the link preview in WhatsApp: the title and the first lines, in the link's language. Null when the link is closed. */
export async function sharedPreview(kind: SharedKind, id: string, lang: 'en' | 'fr'): Promise<{ title: string; text: string } | null> {
  const item = await publicItem(kind, id);
  if (!item) return null;
  return { title: item.title[lang], text: excerpt(item.body[lang]) };
}
