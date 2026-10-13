import { prisma } from './prisma';
import { profilePhotoPath } from './profilePhoto';

// Section 15: per-post choice for Announcements, HeadquartersPosts, and a
// Live session — post as the plain institutional "Central Authority" (no
// personal face) or as the Admin personally (photo, name, and a shared
// title shown alongside the content). Never affects which content-type/
// model the post is stored as, or its placement/prominence on the home
// page ("pinning") — purely a display choice layered on top.

export class AuthorToggleError extends Error {}

/**
 * Resolves the authorPersonId to store on a new/edited Announcement,
 * HeadquartersPost, or Live session. `postAsSelf: true` always names the
 * acting Admin's own bridged Person — never anyone else's, and never
 * inferred — so the Admin must already be bridged (adminMemberBridge.ts).
 * Omitted/false clears it back to the plain institutional voice.
 */
export function resolveAuthorPersonId(adminPersonId: string | null, postAsSelf: boolean | undefined): string | null {
  if (!postAsSelf) return null;
  if (!adminPersonId) {
    throw new AuthorToggleError('Link your account to a Member profile first before posting as yourself.');
  }
  return adminPersonId;
}

export interface AuthorDisplay {
  personId: string;
  name: string;
  photoUrl: string | null;
  title: string | null;
}

/** Single-row lookup — for a post detail/create/publish response. */
export async function getAuthorDisplay(authorPersonId: string | null): Promise<AuthorDisplay | null> {
  if (!authorPersonId) return null;
  const map = await getAuthorDisplaysByIds([authorPersonId]);
  return map.get(authorPersonId) ?? null;
}

/**
 * Batched lookup for a list of posts — one Settings read and one Person
 * query total, never one per row. In practice there is only ever one
 * distinct authorPersonId at a time (see Settings.authorTitle's own
 * comment), but this stays correct if that is ever split across people.
 */
export async function getAuthorDisplaysByIds(authorPersonIds: (string | null)[]): Promise<Map<string, AuthorDisplay>> {
  const ids = Array.from(new Set(authorPersonIds.filter((id): id is string => Boolean(id))));
  const result = new Map<string, AuthorDisplay>();
  if (ids.length === 0) return result;

  const [people, settings] = await Promise.all([
    prisma.person.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, photoStorageKey: true, photoUpdatedAt: true } }),
    prisma.settings.findUnique({ where: { id: 'singleton' }, select: { authorTitle: true } }),
  ]);
  for (const p of people) {
    result.set(p.id, { personId: p.id, name: p.name, photoUrl: profilePhotoPath(p), title: settings?.authorTitle ?? null });
  }
  return result;
}
