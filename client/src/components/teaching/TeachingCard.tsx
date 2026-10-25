import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ChatTeaching } from '../chat/types';

const KIND_ICON = { AUDIO: '🎧', VIDEO: '🎬', PDF: '📄' } as const;

/**
 * A teaching in the assembly's chat: its title, what it contains, and where
 * the viewer is with it (not opened / started / finished and quiz open /
 * passed with the score / failed). Tapping opens the teaching page.
 */
export function TeachingCard({ teaching }: { teaching: ChatTeaching }) {
  const { t } = useTranslation();
  const closed = new Date(teaching.closesAt).getTime() < Date.now();
  const parts = [teaching.hasText ? `📖 ${t('teaching.part_text')}` : null, teaching.mediaKind ? `${KIND_ICON[teaching.mediaKind]} ${t(`teaching.part_${teaching.mediaKind.toLowerCase()}`)}` : null].filter(Boolean);
  const status =
    teaching.myState === 'PASSED' || teaching.myState === 'FAILED'
      ? t(teaching.myState === 'PASSED' ? 'teaching.card_passed' : 'teaching.card_failed', { percent: Math.round(teaching.myPercentage ?? 0) })
      : teaching.myState === 'FINISHED'
        ? t('teaching.card_finished')
        : teaching.myState === 'STARTED'
          ? t('teaching.card_started')
          : closed
            ? t('teaching.card_closed')
            : t('teaching.card_new');
  const tone =
    teaching.myState === 'PASSED' ? 'bg-green-50 text-green-800' : teaching.myState === 'FAILED' ? 'bg-amber-50 text-amber-800' : teaching.myState === 'FINISHED' ? 'bg-sky-50 text-sky-800' : 'bg-slate-100 text-slate-700';
  return (
    <Link
      to={`/member/teachings/${teaching.id}`}
      onClick={(e) => e.stopPropagation()}
      className="block min-w-[14rem] rounded-lg border border-emerald-200 bg-white p-3 no-underline"
      data-testid="teaching-card"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">📖 {t('teaching.label')}</p>
      <p className="mt-0.5 break-words text-base font-semibold text-slate-900">{teaching.title}</p>
      {parts.length > 0 && <p className="mt-0.5 text-xs text-slate-500">{parts.join(' · ')}</p>}
      <p className={`mt-2 rounded px-2 py-1 text-xs font-medium ${tone}`}>{status}</p>
      <p className="mt-2 text-sm font-semibold text-emerald-700">{t('teaching.open')} →</p>
    </Link>
  );
}
