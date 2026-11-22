import { Fragment, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';

interface Term {
  term: string;
  text: string;
}

/** **bold** and [[Button name]] in a guide line. */
function rich(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*|\[\[[^\]]+\]\])/g).map((part, i) => {
    if (part.startsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('[[')) return <span key={i} className="rounded bg-sky-100 px-1.5 py-0.5 font-semibold text-brand-900">{part.slice(2, -2)}</span>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

function Steps({ items }: { items: string[] }) {
  return (
    <ol className="space-y-3">
      {items.map((s, i) => (
        <li key={i} className="flex gap-3">
          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-900 text-sm font-bold text-white">{i + 1}</span>
          <span className="min-w-0">{rich(s)}</span>
        </li>
      ))}
    </ol>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-2 pl-5">
      {items.map((s, i) => (
        <li key={i}>{rich(s)}</li>
      ))}
    </ul>
  );
}

function Terms({ items }: { items: Term[] }) {
  return (
    <dl className="space-y-3">
      {items.map((x) => (
        <div key={x.term}>
          <dt className="font-bold text-brand-900">{x.term}</dt>
          <dd>{rich(x.text)}</dd>
        </div>
      ))}
    </dl>
  );
}

// The simple guide for the weekly teachers: what to do before, on the day and after; why a teaching is recorded in short
// pieces of about 5 minutes; and that recording ahead is only for before the teaching time, when the time comes you go live.
export function MemberTeachingGuidePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // "Back" goes back to where the teacher came from (a message, the teaching page); with nowhere to go back to, to My teaching.
  const goBack = () => (window.history.length > 1 ? navigate(-1) : navigate('/member/my-teaching'));
  const list = (key: string) => t(`teachingGuide.${key}`, { returnObjects: true }) as string[];
  const terms = (key: string) => t(`teachingGuide.${key}`, { returnObjects: true }) as Term[];

  return (
    <PageShell minimal>
      <article className="mx-auto max-w-2xl space-y-5 px-4 py-6 pb-16 text-[1.06rem] leading-relaxed text-slate-800" data-testid="teaching-guide">
        <button type="button" onClick={goBack} className="text-sm font-semibold underline" data-testid="guide-back">← {t('teachingGuide.back')}</button>
        <header>
          <h1 className="text-2xl font-bold text-brand-900">{t('teachingGuide.title')}</h1>
          <p className="mt-1 text-slate-600">{t('teachingGuide.lede')}</p>
        </header>

        <section className="card space-y-3">
          <h2 className="text-xl font-bold text-brand-900">{t('teachingGuide.short.title')}</h2>
          {list('short.items').map((p, i) => <p key={i}>{rich(p)}</p>)}
        </section>

        <section className="space-y-3 rounded-xl border-2 border-amber-400 bg-amber-50 p-4" data-testid="guide-pieces">
          <h2 className="text-xl font-bold text-amber-900">{t('teachingGuide.pieces.title')}</h2>
          {list('pieces.items').map((p, i) => <p key={i}>{rich(p)}</p>)}
        </section>

        <section className="card space-y-3">
          <h2 className="text-xl font-bold text-brand-900">{t('teachingGuide.words.title')}</h2>
          <Terms items={terms('words.items')} />
        </section>

        <section className="card space-y-3">
          <h2 className="text-xl font-bold text-brand-900">{t('teachingGuide.before.title')}</h2>
          <Steps items={list('before.steps')} />
          <p className="rounded-lg bg-sky-50 px-3 py-2 text-sm">{t('teachingGuide.before.tip')}</p>
        </section>

        <section className="space-y-3 rounded-xl border-2 border-brand-900 bg-white p-4" data-testid="guide-choose">
          <h2 className="text-xl font-bold text-brand-900">{t('teachingGuide.choose.title')}</h2>
          {list('choose.items').map((p, i) => <p key={i}>{rich(p)}</p>)}
        </section>

        <section className="card space-y-3" data-testid="guide-way1">
          <span className="inline-block rounded-full bg-amber-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-amber-900">{t('teachingGuide.way1.tag')}</span>
          <h2 className="text-xl font-bold text-brand-900">{t('teachingGuide.way1.title')}</h2>
          <p>{rich(t('teachingGuide.way1.intro'))}</p>
          <Steps items={list('way1.steps')} />
          <p className="rounded-lg bg-sky-50 px-3 py-2 text-sm">{rich(t('teachingGuide.way1.tip'))}</p>
        </section>

        <section className="card space-y-3" data-testid="guide-way2">
          <span className="inline-block rounded-full bg-amber-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-amber-900">{t('teachingGuide.way2.tag')}</span>
          <h2 className="text-xl font-bold text-brand-900">{t('teachingGuide.way2.title')}</h2>
          <p>{rich(t('teachingGuide.way2.intro'))}</p>
          <Steps items={list('way2.steps')} />
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-900">{rich(t('teachingGuide.way2.tip'))}</p>
        </section>

        <section className="card space-y-3">
          <h2 className="text-xl font-bold text-brand-900">{t('teachingGuide.after.title')}</h2>
          <Bullets items={list('after.items')} />
        </section>

        <section className="card space-y-3">
          <h2 className="text-xl font-bold text-brand-900">{t('teachingGuide.trouble.title')}</h2>
          <Terms items={terms('trouble.items')} />
        </section>

        <section className="space-y-3 rounded-xl border-2 border-brand-900 bg-white p-4">
          <h2 className="text-xl font-bold text-brand-900">{t('teachingGuide.remember.title')}</h2>
          <Bullets items={list('remember.items')} />
        </section>
      </article>
    </PageShell>
  );
}
