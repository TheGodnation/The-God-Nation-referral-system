import { useTranslation } from 'react-i18next';
import type { TopicText } from './teachingTypes';

// One teaching, laid out in the order the teacher uses it. The wording is the owner's and is shown exactly as written.
function Part({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-brand-700">{label}</h4>
      <p className="mt-0.5 whitespace-pre-line text-sm leading-relaxed text-slate-800">{children}</p>
    </div>
  );
}

export function TeachingTopicView({ text }: { text: TopicText }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3" data-testid="topic-view">
      <Part label={t('teachingRota.s_teaching_on')}>{text.teachingOn}</Part>
      <Part label={t('teachingRota.s_where')}>{`${text.bookTitle}, ${text.chapter}`}</Part>
      <Part label={t('teachingRota.s_help')}>{text.help}</Part>
      <Part label={t('teachingRota.s_meaning')}>{text.meaning}</Part>
      <Part label={text.startLabel}>{text.start}</Part>
      <Part label={text.ifNotLabel}>{text.ifNot}</Part>
      <Part label={t('teachingRota.s_dominion')}>{text.dominion}</Part>
      {text.verses.length > 0 && <Part label={t('teachingRota.s_verses')}>{text.verses.join(' · ')}</Part>}
    </div>
  );
}
