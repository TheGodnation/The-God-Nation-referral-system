import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { useMediaUploads } from '../../lib/useMediaUploads';
import { Avatar } from '../Avatar';
import { ChatComposer, type OutgoingMessage } from '../chat/ChatComposer';
import { UploadingBubble } from '../chat/UploadingBubble';
import { FollowUpButtons } from '../leader/FollowUpButtons';
import { WhatsAppQueue, type QueuePerson } from './WhatsAppQueue';
import { LeaderAlerts } from './LeaderAlerts';
import { TranslateToggle, useTranslationPreview, type SentTranslation } from '../BroadcastTranslation';

type Filter = 'today' | 'needs' | 'all' | 'not_confirmed' | 'profile_incomplete' | 'never_back' | 'quiet' | 'no_leader' | 'leader_silent' | 'not_in_group' | 'mine';
const FILTERS: Filter[] = ['today', 'needs', 'not_confirmed', 'profile_incomplete', 'never_back', 'quiet', 'no_leader', 'leader_silent', 'not_in_group', 'mine', 'all'];
type Wellbeing = 'GOOD' | 'NEEDS_ATTENTION' | 'EMERGENCY' | 'UNABLE_TO_REACH';

interface Person {
  personId: string;
  name: string;
  photoUrl: string | null;
  whatsapp: string | null;
  language: 'en' | 'fr';
  joinedAt: string;
  status: 'NOT_CONFIRMED' | 'PROFILE_INCOMPLETE' | 'QUIET' | 'ACTIVE';
  daysQuiet: number | null;
  leader: { personId: string; name: string } | null;
  mine: boolean;
  lastContactAt: string | null;
  lastWellbeing?: Wellbeing | null;
  leaderSilent: boolean;
  noLeader: boolean;
  notInGroup: boolean;
  whatsappConsent?: 'AGREED' | 'NONE' | 'OPTED_OUT';
}
interface Result {
  items: Person[];
  total: number;
  page: number;
  pageSize: number;
  capped: boolean;
  counts: Record<Filter, number>;
  contactedToday?: number;
}

const STATUS_STYLE: Record<Person['status'], string> = {
  NOT_CONFIRMED: 'bg-slate-100 text-slate-700',
  PROFILE_INCOMPLETE: 'bg-amber-100 text-amber-800',
  QUIET: 'bg-orange-100 text-orange-800',
  ACTIVE: 'bg-green-100 text-green-800',
};
const daysAgo = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));

/**
 * "People who need me": the National Coordinator's own desk. Everyone who has joined, how far each one has got, who
 * their leader is and when anyone last contacted them. From here the coordinator can reach them on WhatsApp or in the
 * app, take a person over from a leader who is not following up, record a contact, and write to many at once.
 */
export function NeedsMePanel({ base }: { base: string }) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<Filter>('today');
  const [q, setQ] = useState('');
  const [language, setLanguage] = useState('');
  const [communityId, setCommunityId] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Result | null>(null);
  const [assemblies, setAssemblies] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [composing, setComposing] = useState(false);
  const [contactFor, setContactFor] = useState<string | null>(null);
  const [wellbeing, setWellbeing] = useState<Wellbeing>('GOOD');
  const [contactNote, setContactNote] = useState('');
  // Everyone seen so far (this page and "select all"): who reads what language, and who has a WhatsApp number.
  const [known, setKnown] = useState<Record<string, QueuePerson>>({});
  const [queueOpen, setQueueOpen] = useState(false);

  const query = useMemo(() => {
    const p = new URLSearchParams({ filter });
    if (q.trim()) p.set('q', q.trim());
    if (language) p.set('language', language);
    if (communityId) p.set('communityId', communityId);
    return p;
  }, [filter, q, language, communityId]);

  const load = useCallback(() => {
    const p = new URLSearchParams(query);
    p.set('page', String(page));
    return api
      .get<Result>(`${base}?${p.toString()}`)
      .then((r) => {
        setData(r);
        setKnown((prev) => ({ ...prev, ...Object.fromEntries(r.items.map((i) => [i.personId, { personId: i.personId, name: i.name, whatsapp: i.whatsapp, language: i.language, consent: i.whatsappConsent }])) }));
        setError(null);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : t('needsMe.load_failed')));
  }, [base, query, page, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), q ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [load, q]);
  useEffect(() => {
    api.get<{ items: { id: string; name: string }[] }>(`${base}/assemblies`).then((r) => setAssemblies(r.items)).catch(() => {});
  }, [base]);

  const changeFilter = (f: Filter) => {
    setFilter(f);
    setPage(1);
    setSelected(new Set());
  };
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function selectEverything() {
    try {
      const r = await api.get<{ ids: string[]; total: number; people?: QueuePerson[] }>(`${base}/ids?${query.toString()}`);
      setSelected(new Set(r.ids));
      if (r.people) setKnown((prev) => ({ ...prev, ...Object.fromEntries(r.people!.map((p) => [p.personId, p])) }));
      if (r.total > r.ids.length) setNote(t('needsMe.select_capped', { count: r.ids.length }));
    } catch {
      setError(t('needsMe.load_failed'));
    }
  }

  // They asked to stop being written to on WhatsApp ("Opted out"): recorded, and they are left out of every WhatsApp queue.
  async function stopWhatsApp(p: { personId: string; name: string }, quiet = false) {
    setError(null);
    try {
      await api.post(`${base}/whatsapp-stop`, { personId: p.personId });
      setKnown((prev) => (prev[p.personId] ? { ...prev, [p.personId]: { ...prev[p.personId], consent: 'OPTED_OUT' } } : prev));
      if (!quiet) {
        setNote(t('needsMe.stopped', { name: p.name }));
        await load();
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('needsMe.action_failed'));
      throw e;
    }
  }

  async function takeOver(p: Person) {
    setError(null);
    try {
      await api.post(`${base}/take-over`, { personId: p.personId });
      setNote(t('needsMe.taken_over', { name: p.name }));
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('needsMe.action_failed'));
    }
  }

  async function saveContact(p: Person) {
    setError(null);
    try {
      await api.post(`${base}/contacted`, { personId: p.personId, wellbeing, note: contactNote.trim() || null });
      setContactFor(null);
      setContactNote('');
      setWellbeing('GOOD');
      setNote(t('needsMe.contact_saved', { name: p.name }));
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('needsMe.action_failed'));
    }
  }

  const selectedFrench = [...selected].filter((id) => known[id]?.language === 'fr').length;
  const selectedEnglish = [...selected].filter((id) => known[id]?.language === 'en').length;
  const mixed = selectedFrench > 0 && selectedEnglish > 0;
  const [wantTranslate, setWantTranslate] = useState<boolean | null>(null);
  const translateOn = wantTranslate ?? mixed;

  const sendFinal = useCallback(
    async (out: OutgoingMessage, translation: SentTranslation | null): Promise<boolean> => {
      if (selected.size === 0) {
        setError(t('needsMe.nobody_selected'));
        return false;
      }
      setError(null);
      try {
        const res = await api.post<{ recipients: number; skipped: number }>(`${base}/message`, { personIds: [...selected], body: out.body, attachments: out.attachments, ...(translation ? { translation } : {}) });
        setNote(t('needsMe.sent', { count: res.recipients }) + (res.skipped > 0 ? ' ' + t('needsMe.skipped', { count: res.skipped }) : ''));
        setComposing(false);
        setSelected(new Set());
        void load();
        return true;
      } catch (e) {
        setError(e instanceof ApiError ? e.message : t('needsMe.send_failed'));
        return false;
      }
    },
    [selected, base, load, t],
  );
  const preview = useTranslationPreview({ translateUrl: `${base}/translate-preview`, english: selectedEnglish, french: selectedFrench, enabled: translateOn, sendFinal });
  const send = preview.intercept;
  const media = useMediaUploads(`${base}/attachments/authorize`, send);

  const items = data?.items ?? [];
  const queuePeople = [...selected].map((id) => known[id]).filter((p): p is QueuePerson => Boolean(p));
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4" data-testid="needs-me-panel">
      <div>
        <h2 className="text-lg font-bold text-brand-900">{t('needsMe.title')}</h2>
        <p className="text-sm text-slate-600">{t('needsMe.help')}</p>
      </div>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
      {note && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800" role="status">{note}</p>}

      <LeaderAlerts base={base} onChanged={() => void load()} />

      {data && typeof data.contactedToday === 'number' && data.contactedToday > 0 && (
        <p className="text-sm font-medium text-green-800" data-testid="needs-today-done">{t('needsMe.today_done', { count: data.contactedToday })}</p>
      )}

      <div className="flex flex-wrap gap-2" role="group" aria-label={t('needsMe.filters') ?? ''}>
        {FILTERS.map((f) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => changeFilter(f)} data-testid={`needs-filter-${f}`}
            className={`rounded-full px-3 py-1 text-sm font-medium ${filter === f ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-700'}`}>
            {t(`needsMe.filter_${f}`)}{data ? ` (${data.counts[f]})` : ''}
          </button>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder={t('needsMe.search') ?? ''} className="input" aria-label={t('needsMe.search') ?? ''} />
        <select value={communityId} onChange={(e) => { setCommunityId(e.target.value); setPage(1); }} className="input" aria-label={t('needsMe.assembly') ?? ''}>
          <option value="">{t('needsMe.all_assemblies')}</option>
          {assemblies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select value={language} onChange={(e) => { setLanguage(e.target.value); setPage(1); }} className="input" aria-label={t('needsMe.language') ?? ''}>
          <option value="">{t('needsMe.any_language')}</option>
          <option value="en">English</option>
          <option value="fr">Français</option>
        </select>
      </div>

      {data && (
        <section className="card space-y-2" data-testid="needs-bar">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <button type="button" className="underline" onClick={() => setSelected(new Set(items.map((p) => p.personId)))}>{t('needsMe.select_page')}</button>
            <button type="button" className="underline" onClick={() => void selectEverything()} data-testid="needs-select-all">{t('needsMe.select_all', { count: data.total })}</button>
            <button type="button" className="underline" onClick={() => setSelected(new Set())}>{t('needsMe.select_none')}</button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <p className="font-semibold text-brand-900" data-testid="needs-selected">{t('needsMe.selected', { count: selected.size })}</p>
            {selected.size > 0 && (
              <p className="text-sm text-slate-600" data-testid="needs-selected-languages">{t('needsMe.selected_languages', { en: selectedEnglish, fr: selectedFrench })}</p>
            )}
            <button type="button" disabled={selected.size === 0} onClick={() => setComposing((v) => !v)} className="btn-primary disabled:opacity-50" data-testid="needs-write">
              {t('needsMe.write_selected')}
            </button>
            <button type="button" disabled={selected.size === 0} onClick={() => setQueueOpen((v) => !v)} className="btn-secondary disabled:opacity-50" data-testid="needs-queue">
              {t('needsMe.queue_button')}
            </button>
          </div>
          {composing && (
            <div className="space-y-2">
              <p className="text-xs text-slate-500">{t('needsMe.sent_as')}</p>
              <TranslateToggle mixed={mixed} value={wantTranslate} onChange={setWantTranslate} />
              {!translateOn && mixed && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900" data-testid="needs-mixed-warning">{t('needsMe.mixed_warning', { en: selectedEnglish, fr: selectedFrench })}</p>}
              {!translateOn && selectedFrench > 0 && selectedEnglish === 0 && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">{t('needsMe.french_only_warning')}</p>}
              {preview.panel}
              {media.jobs.map((job) => (
                <UploadingBubble key={job.id} job={job} onCancel={() => media.cancel(job.id)} onRetry={() => media.retry(job.id)} />
              ))}
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <ChatComposer draftKey="needs-me" uploadPath={`${base}/attachments/authorize`} replyTo={null} onCancelReply={() => {}} onSend={send} onPickMedia={(files, caption) => media.start(files, undefined, caption)} />
              </div>
            </div>
          )}
        </section>
      )}

      {queueOpen && <WhatsAppQueue key={[...selected].join(',')} people={queuePeople} defaultKind={filter === 'not_confirmed' || filter === 'profile_incomplete' ? 'help' : 'nudge'} onStop={(p) => stopWhatsApp(p, true)} translateUrl={`${base}/translate-preview`} onClose={() => setQueueOpen(false)} recordContact={(p) => api.post(`${base}/contacted`, { personId: p.personId, wellbeing: 'GOOD', note: 'WhatsApp' })} />}

      {data === null && !error && <p className="text-sm text-slate-400">{t('needsMe.loading')}</p>}
      {data && items.length === 0 && <p className="card text-sm text-slate-600">{t('needsMe.nobody')}</p>}

      <ul className="divide-y divide-slate-100 rounded-xl bg-white shadow-sm">
        {items.map((p) => (
          <li key={p.personId} className="px-3 py-3" data-testid={`needs-${p.personId}`}>
            <div className="flex items-start gap-3">
              <input type="checkbox" className="mt-4" checked={selected.has(p.personId)} onChange={() => toggle(p.personId)} aria-label={t('needsMe.select_person', { name: p.name }) ?? ''} />
              <Link to={`/member/people/${p.personId}`} className="flex min-w-0 flex-1 items-center gap-3">
                <Avatar name={p.name} photoUrl={p.photoUrl} size={44} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-slate-800">{p.name}</span>
                  <span className="block text-xs text-slate-500">
                    {t('myReferrals.joined_on', { date: new Date(p.joinedAt).toLocaleDateString() })}
                    {' · '}
                    <span className={`font-semibold ${p.language === 'fr' ? 'text-blue-800' : 'text-emerald-800'}`} data-testid={`needs-language-${p.personId}`}>
                      {p.language === 'fr' ? t('needsMe.lang_fr') : t('needsMe.lang_en')}
                    </span>
                  </span>
                </span>
              </Link>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[p.status]}`}>{t(`myReferrals.status_${p.status}`, { count: p.daysQuiet ?? 0 })}</span>
            </div>
            <div className="space-y-2 pb-1 pl-9 pt-2">
              <p className="text-sm text-slate-700" data-testid={`needs-leader-${p.personId}`}>
                {p.mine ? t('needsMe.i_follow') : p.leader ? t('needsMe.leader_is', { name: p.leader.name }) : t('needsMe.no_leader')}
                {' · '}
                {p.lastContactAt ? t('needsMe.last_contact', { count: daysAgo(p.lastContactAt) }) : t('needsMe.never_contacted')}
              </p>
              <div className="flex flex-wrap gap-1.5 text-xs">
                {p.leaderSilent && <span className="rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-800">{t('needsMe.flag_silent')}</span>}
                {p.notInGroup && <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">{t('followUp.not_joined')}</span>}
                {p.lastWellbeing && p.lastWellbeing !== 'GOOD' && <span className="rounded-full bg-orange-100 px-2 py-0.5 font-medium text-orange-800" data-testid={`needs-wellbeing-${p.personId}`}>{t('needsMe.last_time', { status: t(`needsMe.wellbeing_${p.lastWellbeing}`) })}</span>}
              </div>
              <p className="text-xs" data-testid={`needs-consent-${p.personId}`}>
                {p.whatsappConsent === 'AGREED' ? (
                  <span className="text-green-700">✓ {t('needsMe.consent_agreed')}</span>
                ) : p.whatsappConsent === 'OPTED_OUT' ? (
                  <span className="font-semibold text-red-700">{t('needsMe.consent_optedout')}</span>
                ) : (
                  <span className="text-slate-500">{t('needsMe.consent_none')}</span>
                )}
              </p>
              {p.whatsapp && p.whatsappConsent !== 'OPTED_OUT' && <FollowUpButtons personId={p.personId} whatsapp={p.whatsapp} language={p.language} />}
              <div className="flex flex-wrap gap-2">
                <Link to={`/member/people/${p.personId}`} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-brand-800 no-underline hover:bg-brand-50">
                  {t('myReferrals.nudge_in_app')}
                </Link>
                {!p.mine && (
                  <button type="button" onClick={() => void takeOver(p)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-brand-800 hover:bg-brand-50" data-testid={`needs-takeover-${p.personId}`}>
                    {t('needsMe.take_over')}
                  </button>
                )}
                {p.whatsappConsent !== 'OPTED_OUT' && (
                  <button type="button" onClick={() => void stopWhatsApp(p).catch(() => {})} className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50" data-testid={`needs-stop-${p.personId}`}>
                    {t('needsMe.opted_out_button')}
                  </button>
                )}
                <button type="button" onClick={() => setContactFor(contactFor === p.personId ? null : p.personId)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-brand-800 hover:bg-brand-50" data-testid={`needs-contacted-${p.personId}`}>
                  {t('needsMe.i_contacted')}
                </button>
              </div>
              {contactFor === p.personId && (
                <div className="space-y-2 rounded-lg bg-slate-50 p-3">
                  <select value={wellbeing} onChange={(e) => setWellbeing(e.target.value as Wellbeing)} className="input" aria-label={t('needsMe.how_is_he') ?? ''}>
                    {(['GOOD', 'NEEDS_ATTENTION', 'EMERGENCY', 'UNABLE_TO_REACH'] as Wellbeing[]).map((w) => <option key={w} value={w}>{t(`needsMe.wellbeing_${w}`)}</option>)}
                  </select>
                  <textarea value={contactNote} onChange={(e) => setContactNote(e.target.value)} rows={2} maxLength={2000} placeholder={t('needsMe.note_placeholder') ?? ''} className="input" />
                  <button type="button" className="btn-primary" onClick={() => void saveContact(p)} data-testid={`needs-save-contact-${p.personId}`}>{t('needsMe.save_contact')}</button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>

      {data && pages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <button type="button" disabled={page <= 1} onClick={() => setPage((v) => v - 1)} className="btn-secondary disabled:opacity-40">{t('needsMe.previous')}</button>
          <span className="text-slate-500">{t('needsMe.page_of', { page, pages })}</span>
          <button type="button" disabled={page >= pages} onClick={() => setPage((v) => v + 1)} className="btn-secondary disabled:opacity-40">{t('needsMe.next')}</button>
        </div>
      )}
      {data?.capped && <p className="text-xs text-slate-500">{t('needsMe.capped')}</p>}
    </div>
  );
}
