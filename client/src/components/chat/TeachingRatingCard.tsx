import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { LEVELS, type Level } from '../teaching/teachingTypes';
import { CountChips } from '../teaching/TeachingRatings';
import type { RatingCardInfo } from './types';

const TONE: Record<Level, string> = {
  EXCELLENT: 'border-green-600 bg-green-600 text-white',
  VERY_GOOD: 'border-emerald-500 bg-emerald-500 text-white',
  GOOD: 'border-sky-500 bg-sky-500 text-white',
  KEEP_GROWING: 'border-amber-500 bg-amber-500 text-white',
};

// In the teaching group: the card that appears after a teacher's voice notes. Members rate the teaching with one of four
// buttons, at any time, and can change it. Everyone sees how many gave each level, never who; the National Coordinator's
// own rating is shown to all.
export function TeachingRatingCard({ messageId, initial }: { messageId: string; initial: RatingCardInfo | null | undefined }) {
  const { t } = useTranslation();
  const [info, setInfo] = useState<RatingCardInfo | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (initial) setInfo(initial);
  }, [initial]);
  if (!info) return null;

  async function choose(level: Level) {
    setError(null);
    try {
      const r = await api.post<{ card: RatingCardInfo | null }>('/api/member/teaching-rota/rate', { messageId, level });
      if (r.card) setInfo(r.card);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('teachingRota.rate_failed'));
    }
  }

  return (
    <div className="mx-auto my-3 w-[92%] max-w-md rounded-2xl border border-sky-200 bg-sky-50 p-3 text-sm shadow-sm" data-testid={`rating-card-${messageId}`}>
      <p className="font-semibold text-sky-950">📖 {t('teachingRota.card_title', { name: info.teacherName, topic: info.topic })}</p>
      {info.canRate ? (
        <>
          <p className="mt-0.5 text-slate-700">{t('teachingRota.card_listen')}</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {LEVELS.map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={info.myLevel === l}
                onClick={() => void choose(l)}
                className={`rounded-lg border px-2 py-2 text-sm font-semibold ${info.myLevel === l ? TONE[l] : 'border-slate-300 bg-white text-slate-700'}`}
              >
                {t(`teachingRota.level_${l}`)}
              </button>
            ))}
          </div>
          {info.myLevel && <p className="mt-1.5 text-xs font-medium text-green-800">✓ {t('teachingRota.card_you_chose', { level: t(`teachingRota.level_${info.myLevel}`) })}</p>}
        </>
      ) : info.isOwnTeaching ? (
        <p className="mt-0.5 text-slate-700">{t('teachingRota.card_own')}</p>
      ) : null}
      {error && <p role="alert" className="mt-1 text-xs text-red-700">{error}</p>}
      <div className="mt-2 space-y-1 border-t border-sky-200 pt-2">
        {info.coordinator && (
          <p className="font-semibold text-slate-900" data-testid="coordinator-rating">
            ⭐ {t('teachingRota.card_coordinator', { name: info.coordinator.name, level: t(`teachingRota.level_${info.coordinator.level}`) })}
          </p>
        )}
        <p className="text-xs text-slate-600">{info.total === 0 ? t('teachingRota.card_nobody') : t('teachingRota.card_rated', { count: info.total })}</p>
        {info.total > 0 && <CountChips counts={info.counts} />}
      </div>
    </div>
  );
}

// For the teacher, inside the teaching group, from the start of their slot: one tap says "I have finished", and the rating
// card appears in the group. Anyone else sees nothing.
export function TeachingFinishButton({ communityId, onPosted }: { communityId: string; onPosted: () => void }) {
  const { t } = useTranslation();
  const [state, setState] = useState<{ available: boolean; topic?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .get<{ available: boolean; topic?: string }>(`/api/member/teaching-rota/finish-state?communityId=${encodeURIComponent(communityId)}`)
        .then((r) => alive && setState(r))
        .catch(() => alive && setState({ available: false }));
    void load();
    const timer = window.setInterval(() => document.visibilityState === 'visible' && void load(), 60000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [communityId]);

  if (!state?.available) return null;

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/member/teaching-rota/finish', {});
      setState({ available: false });
      onPosted();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('teachingRota.finish_failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-slate-200 bg-white px-4 py-2" data-testid="finish-teaching">
      <button type="button" className="btn-primary w-full" disabled={busy} onClick={() => void finish()}>
        ✅ {t('teachingRota.finish_button')}
      </button>
      {state.topic && <p className="mt-1 text-center text-xs text-slate-500">{state.topic}</p>}
      {error && <p role="alert" className="mt-1 text-center text-xs text-red-700">{error}</p>}
    </div>
  );
}
