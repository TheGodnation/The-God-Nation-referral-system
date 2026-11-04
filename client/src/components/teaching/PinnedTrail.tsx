import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { orderedPins, type ChatPin } from '../chat/PinnedMessages';

/**
 * A teaching (or its quiz) opened from the Pinned page carries `?pins=<assembly>`. This shows where it
 * sits among the pinned messages and offers the next one, so the person goes on without going through
 * the chat and carries on from where they stopped.
 */
export function usePinnedTrail(communityId: string | null, teachingId: string | null | undefined, refreshKey?: unknown) {
  const [pins, setPins] = useState<ChatPin[] | null>(null);
  useEffect(() => {
    if (!communityId) return;
    let live = true;
    api
      .get<{ pins?: ChatPin[] }>(`/api/communities/${communityId}/conversation`)
      .then((r) => live && setPins(orderedPins(r.pins ?? [])))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [communityId, refreshKey]);
  if (!communityId || !pins) return null;
  const at = pins.findIndex((p) => p.teachingId === teachingId);
  if (at < 0) return null;
  const chatPath = `/member/chats/group/${communityId}`;
  const pinnedPath = (id: string) => `${chatPath}/pinned/${id}`;
  return { at, total: pins.length, current: pins[at], next: pins[at + 1] ?? null, previous: pins[at - 1] ?? null, chatPath, pinnedPath };
}

type Trail = NonNullable<ReturnType<typeof usePinnedTrail>>;

/** The top line: "📌 Pinned 2 of 5 · back to the list". */
export function PinnedTrailTop({ trail }: { trail: Trail }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-x-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950" data-testid="pinned-trail-top">
      <span className="font-semibold">📌 {t('pins.pin_progress', { current: trail.at + 1, total: trail.total })}</span>
      <Link to={trail.pinnedPath(trail.current.messageId)} className="font-semibold text-brand-700 underline">
        {t('pins.back_to_pinned')}
      </Link>
    </div>
  );
}

/** The bottom: the next pinned message, or Finish after the last one. */
export function PinnedTrailNext({ trail }: { trail: Trail }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-3 pb-4" data-testid="pinned-trail-next">
      {trail.previous && (
        <Link to={trail.pinnedPath(trail.previous.messageId)} className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-brand-700 ring-1 ring-slate-300">
          ← {t('pins.previous')}
        </Link>
      )}
      {trail.next ? (
        <Link to={trail.pinnedPath(trail.next.messageId)} className="rounded-full bg-brand-700 px-5 py-2 text-sm font-semibold text-white">
          {t('pins.next_pinned')} →
        </Link>
      ) : (
        <Link to={trail.chatPath} className="rounded-full bg-brand-700 px-5 py-2 text-sm font-semibold text-white">
          {t('pins.finish')} ✓
        </Link>
      )}
    </div>
  );
}
