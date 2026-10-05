import crypto from 'crypto';
import type { Request } from 'express';
import { prisma } from './prisma';
import { resolveActingPersonId } from './leadership';

// ---------------------------------------------------------------------------
// Updates feed helpers: who is looking, who may delete, YouTube links, and
// photo storage keys. See the UpdatePost schema comment for the rules.
// ---------------------------------------------------------------------------

export interface UpdatesViewer {
  /** The Person posting/commenting/reacting, when the viewer has one. */
  personId: string | null;
  /** The signed-in Admin/Leader account, when there is one. */
  userId: string | null;
  isAdmin: boolean;
  /** Central admin, or any person with an ACTIVE leadership role. */
  canModerate: boolean;
}

/**
 * Works out who is viewing the Updates feed. A member session, a leader
 * account (acting as their linked Person) and an admin account can all
 * view. Returns null for anonymous visitors.
 *
 * A browser can carry both a member session and an admin/leader session at
 * once; the member session decides who is *posting*, and moderation power
 * comes from whichever session grants it.
 */
export async function resolveUpdatesViewer(req: Request): Promise<UpdatesViewer | null> {
  if (!req.member && !req.user) return null;

  const isAdmin = req.user?.role === 'ADMIN';
  const leaderPersonId = req.user?.role === 'LEADER' ? await resolveActingPersonId(req.user.id) : null;
  const personId = req.member?.personId ?? leaderPersonId ?? null;

  let canModerate = isAdmin;
  if (!canModerate) {
    const candidates = [req.member?.personId, leaderPersonId].filter((id): id is string => Boolean(id));
    if (candidates.length > 0) {
      const activeRoles = await prisma.roleAssignment.count({
        where: { personId: { in: candidates }, status: 'ACTIVE' },
      });
      canModerate = activeRoles > 0;
    }
  }

  return { personId, userId: req.user?.id ?? null, isAdmin, canModerate };
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Pulls the 11-character video id out of any common YouTube link (watch,
 * youtu.be, live, shorts, embed; desktop or mobile). Returns null for
 * anything that is not clearly a YouTube video — we only ever store the id
 * and build the embed link ourselves, never echo a raw URL into the page.
 */
export function parseYoutubeVideoId(raw: string): string | null {
  const text = raw.trim();
  if (YOUTUBE_ID.test(text)) return text;
  let url: URL;
  try {
    url = new URL(text.startsWith('http') ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\.|^m\.|^music\./, '').toLowerCase();
  let candidate: string | null = null;
  if (host === 'youtu.be') {
    candidate = url.pathname.split('/')[1] ?? null;
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') candidate = url.searchParams.get('v');
    else {
      const [, kind, id] = url.pathname.split('/');
      if (['live', 'shorts', 'embed', 'v'].includes(kind ?? '')) candidate = id ?? null;
    }
  }
  return candidate && YOUTUBE_ID.test(candidate) ? candidate : null;
}

// Photo storage keys, namespaced to the person who uploads them (same idea
// as profile pictures and chat attachments).
const UPDATE_PHOTO_KEY_PATTERN = /^updates\/([0-9a-f-]{36})\/([0-9a-f-]{36})$/;

export function generateUpdatePhotoStorageKey(personId: string): string {
  return `updates/${personId}/${crypto.randomUUID()}`;
}

export function isStorageKeyForUpdatePhoto(storageKey: string, personId: string): boolean {
  const match = UPDATE_PHOTO_KEY_PATTERN.exec(storageKey);
  return Boolean(match && match[1] === personId);
}

export const MAX_PHOTOS_PER_UPDATE = 4;
export const MAX_UPDATE_BODY = 3000;
export const MAX_COMMENT_BODY = 1000;
export const UPDATES_PAGE_SIZE = 20;
export const REACTION_TYPES = ['LIKE', 'LOVE', 'PRAY', 'PRAISE', 'JOY', 'SAD'] as const;
