import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';

// The central admin's Knowledge Centre editor: write an article in English and French, have a
// person review each language, then publish. Nothing reaches the public website until a version
// is reviewed AND the article is published; changing the words of a reviewed version takes its
// review back, so a changed text is always checked again by a person.
type Lang = 'en' | 'fr';
type Status = 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'SCHEDULED' | 'PUBLISHED' | 'UNPUBLISHED';
const LANGS: Lang[] = ['en', 'fr'];

interface Division { key: string; name: Record<Lang, string>; slug: Record<Lang, string> }
interface Author { id: string; name: string; bioEn: string | null; bioFr: string | null }
interface Faq { q: string; a: string }
interface Tr {
  lang: Lang; slug: string; title: string; summary: string; body?: string; seoTitle: string | null; seoDescription: string | null;
  readingMinutes: number; faq?: Faq[] | null; reviewedAt: string | null; reviewedBy: string | null; publicPath: string | null; isPublic: boolean;
}
interface Article {
  id: string; divisionKey: string; status: Status; authorId: string | null; featuredImageUrl: string | null;
  featuredImageAltEn: string | null; featuredImageAltFr: string | null; publishedAt: string | null; aiAssisted: boolean;
  sourceNote: string | null; updatedAt: string; translations: Tr[]; relatedIds: string[];
}
interface Overview { divisions: Division[]; authors: Author[]; articles: Article[] }

// Which moves are offered from each stage (the server enforces the same rules).
const NEXT: Record<Status, { to: Status; key: string; primary?: boolean }[]> = {
  DRAFT: [{ to: 'IN_REVIEW', key: 'send_review', primary: true }],
  IN_REVIEW: [{ to: 'APPROVED', key: 'approve', primary: true }, { to: 'DRAFT', key: 'back_draft' }],
  APPROVED: [{ to: 'PUBLISHED', key: 'publish', primary: true }, { to: 'DRAFT', key: 'back_draft' }],
  SCHEDULED: [{ to: 'APPROVED', key: 'back_approved' }],
  PUBLISHED: [{ to: 'UNPUBLISHED', key: 'withdraw' }],
  UNPUBLISHED: [{ to: 'PUBLISHED', key: 'publish', primary: true }, { to: 'DRAFT', key: 'back_draft' }],
};
const FILTERS: (Status | 'ALL')[] = ['ALL', 'DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'UNPUBLISHED'];

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError && err.message ? err.message : fallback);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

function StatusPill({ status }: { status: Status }) {
  const { t } = useTranslation();
  const tone = status === 'PUBLISHED' ? 'bg-green-100 text-green-800' : status === 'DRAFT' ? 'bg-slate-100 text-slate-700' : status === 'UNPUBLISHED' ? 'bg-red-50 text-red-700' : 'bg-amber-100 text-amber-800';
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{t(`knowledgeAdmin.status.${status}`)}</span>;
}

export function KnowledgePanel({ base }: { base: string }) {
  const { t, i18n } = useTranslation();
  const uiLang: Lang = i18n.language?.startsWith('fr') ? 'fr' : 'en';
  const [data, setData] = useState<Overview | null>(null);
  const [failed, setFailed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Status | 'ALL'>('ALL');
  const [newArea, setNewArea] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => {
    api.get<Overview>(base).then((d) => { setData(d); setFailed(false); }).catch(() => setFailed(true));
  }, [base]);
  useEffect(load, [load]);

  async function create() {
    setMsg(null);
    try {
      const a = await api.post<Article>(`${base}/articles`, { divisionKey: newArea || data?.divisions[0]?.key });
      load();
      setOpenId(a.id);
    } catch (err) {
      setMsg({ ok: false, text: errorText(err, t('knowledgeAdmin.failed')) });
    }
  }

  if (failed) return <p className="card text-sm text-red-700">{t('knowledgeAdmin.load_failed')}</p>;
  if (!data) return <p className="text-center text-slate-400">{t('knowledgeAdmin.loading')}</p>;

  if (openId) {
    return <ArticleEditor base={base} id={openId} data={data} onBack={() => { setOpenId(null); load(); }} onChanged={load} />;
  }

  const titleOf = (a: Article) => a.translations.find((x) => x.lang === uiLang)?.title || a.translations[0]?.title || t('knowledgeAdmin.untitled');
  const areaName = (key: string) => data.divisions.find((d) => d.key === key)?.name[uiLang] ?? key;
  const shown = data.articles.filter((a) => filter === 'ALL' || a.status === filter);

  return (
    <div className="space-y-4" data-testid="knowledge-panel">
      <div className="card space-y-3">
        <div>
          <h2 className="font-semibold text-brand-900">{t('knowledgeAdmin.title')}</h2>
          <p className="text-xs text-slate-500">{t('knowledgeAdmin.help')}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="label" htmlFor="kc-new-area">{t('knowledgeAdmin.area')}</label>
            <select id="kc-new-area" className="input" value={newArea || data.divisions[0]?.key} onChange={(e) => setNewArea(e.target.value)}>
              {data.divisions.map((d) => <option key={d.key} value={d.key}>{d.name[uiLang]}</option>)}
            </select>
          </div>
          <button type="button" className="btn-primary" onClick={create}>＋ {t('knowledgeAdmin.new_article')}</button>
          <a className="text-sm text-brand-700 underline" href="/en/knowledge/" target="_blank" rel="noreferrer">{t('knowledgeAdmin.view_site')}</a>
        </div>
        {msg && <p role="status" className={`text-sm font-medium ${msg.ok ? 'text-green-700' : 'text-red-700'}`}>{msg.text}</p>}
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label={t('knowledgeAdmin.filter') ?? ''}>
        {FILTERS.map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${filter === f ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300 bg-white text-slate-700'}`}>
            {f === 'ALL' ? t('knowledgeAdmin.all') : t(`knowledgeAdmin.status.${f}`)}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="card text-center text-sm text-slate-500">{t('knowledgeAdmin.none')}</p>
      ) : (
        <ul className="space-y-2">
          {shown.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => setOpenId(a.id)} className="card block w-full text-left hover:shadow" data-testid="kc-row">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-brand-900">{titleOf(a)}</span>
                  <StatusPill status={a.status} />
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span>{areaName(a.divisionKey)}</span>
                  {LANGS.map((l) => {
                    const tr = a.translations.find((x) => x.lang === l);
                    return (
                      <span key={l} className={`rounded px-1.5 py-0.5 ${tr?.reviewedAt ? 'bg-green-50 text-green-800' : tr ? 'bg-amber-50 text-amber-800' : 'bg-slate-50 text-slate-400'}`}>
                        {l.toUpperCase()} {tr?.reviewedAt ? '✓' : tr ? '…' : '–'}
                      </span>
                    );
                  })}
                  <span>{when(a.updatedAt)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <AuthorsBox base={base} authors={data.authors} onChanged={load} />
    </div>
  );
}

function AuthorsBox({ base, authors, onChanged }: { base: string; authors: Author[]; onChanged: () => void }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({ name: '', bioEn: '', bioFr: '' });
  const [editing, setEditing] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      if (editing) await api.put(`${base}/authors/${editing}`, form);
      else await api.post(`${base}/authors`, form);
      setForm({ name: '', bioEn: '', bioFr: '' });
      setEditing(null);
      onChanged();
    } catch (err) {
      setMsg(errorText(err, t('knowledgeAdmin.failed')));
    }
  }
  async function remove(id: string) {
    if (!window.confirm(t('knowledgeAdmin.author_delete_confirm') ?? '')) return;
    await api.delete(`${base}/authors/${id}`).catch(() => undefined);
    onChanged();
  }

  return (
    <details className="card">
      <summary className="cursor-pointer font-semibold text-brand-900">{t('knowledgeAdmin.authors')} ({authors.length})</summary>
      <ul className="mt-3 space-y-2">
        {authors.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-medium">{a.name}</span>
            <span className="flex gap-3">
              <button type="button" className="text-brand-700 underline" onClick={() => { setEditing(a.id); setForm({ name: a.name, bioEn: a.bioEn ?? '', bioFr: a.bioFr ?? '' }); }}>{t('knowledgeAdmin.edit')}</button>
              <button type="button" className="text-red-700 underline" onClick={() => remove(a.id)}>{t('knowledgeAdmin.delete')}</button>
            </span>
          </li>
        ))}
      </ul>
      <form onSubmit={save} className="mt-3 space-y-2">
        <label className="label" htmlFor="kc-author-name">{t('knowledgeAdmin.author_name')}</label>
        <input id="kc-author-name" className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <label className="label" htmlFor="kc-author-bio-en">{t('knowledgeAdmin.author_bio_en')}</label>
        <textarea id="kc-author-bio-en" className="input" rows={2} maxLength={600} value={form.bioEn} onChange={(e) => setForm({ ...form, bioEn: e.target.value })} />
        <label className="label" htmlFor="kc-author-bio-fr">{t('knowledgeAdmin.author_bio_fr')}</label>
        <textarea id="kc-author-bio-fr" className="input" rows={2} maxLength={600} value={form.bioFr} onChange={(e) => setForm({ ...form, bioFr: e.target.value })} />
        <div className="flex gap-2">
          <button type="submit" className="btn-primary">{editing ? t('knowledgeAdmin.save') : t('knowledgeAdmin.add_author')}</button>
          {editing && <button type="button" className="btn-secondary" onClick={() => { setEditing(null); setForm({ name: '', bioEn: '', bioFr: '' }); }}>{t('knowledgeAdmin.cancel')}</button>}
        </div>
        {msg && <p role="alert" className="text-sm text-red-700">{msg}</p>}
      </form>
    </details>
  );
}

interface TrForm { title: string; summary: string; body: string; slug: string; seoTitle: string; seoDescription: string; faq: Faq[] }
const emptyForm = (): TrForm => ({ title: '', summary: '', body: '', slug: '', seoTitle: '', seoDescription: '', faq: [] });
const formOf = (tr?: Tr): TrForm => (tr ? { title: tr.title, summary: tr.summary, body: tr.body ?? '', slug: tr.slug, seoTitle: tr.seoTitle ?? '', seoDescription: tr.seoDescription ?? '', faq: tr.faq ?? [] } : emptyForm());

function ArticleEditor({ base, id, data, onBack, onChanged }: { base: string; id: string; data: Overview; onBack: () => void; onChanged: () => void }) {
  const { t, i18n } = useTranslation();
  const uiLang: Lang = i18n.language?.startsWith('fr') ? 'fr' : 'en';
  const [art, setArt] = useState<Article | null>(null);
  const [lang, setLang] = useState<Lang>('en');
  const [forms, setForms] = useState<Record<Lang, TrForm>>({ en: emptyForm(), fr: emptyForm() });
  const [meta, setMeta] = useState({ divisionKey: '', authorId: '', imageUrl: '', altEn: '', altFr: '', ai: false, source: '', related: [] as string[] });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const apply = useCallback((a: Article) => {
    setArt(a);
    setForms({ en: formOf(a.translations.find((x) => x.lang === 'en')), fr: formOf(a.translations.find((x) => x.lang === 'fr')) });
    setMeta({ divisionKey: a.divisionKey, authorId: a.authorId ?? '', imageUrl: a.featuredImageUrl ?? '', altEn: a.featuredImageAltEn ?? '', altFr: a.featuredImageAltFr ?? '', ai: a.aiAssisted, source: a.sourceNote ?? '', related: a.relatedIds });
  }, []);
  const reload = useCallback(() => api.get<Article>(`${base}/articles/${id}`).then(apply), [base, id, apply]);
  useEffect(() => { reload().catch(() => setMsg({ ok: false, text: t('knowledgeAdmin.load_failed') })); }, [reload, t]);

  if (!art) return <p className="text-center text-slate-400">{t('knowledgeAdmin.loading')}</p>;

  const tr = art.translations.find((x) => x.lang === lang);
  const f = forms[lang];
  const setF = (patch: Partial<TrForm>) => setForms({ ...forms, [lang]: { ...f, ...patch } });
  const fail = (err: unknown) => setMsg({ ok: false, text: errorText(err, t('knowledgeAdmin.failed')) });
  const ok = (text: string) => setMsg({ ok: true, text });

  async function saveTr(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      const r = await api.put<{ reviewReset: boolean }>(`${base}/articles/${id}/translations/${lang}`, {
        title: f.title, summary: f.summary, body: f.body, ...(f.slug ? { slug: f.slug } : {}),
        seoTitle: f.seoTitle || null, seoDescription: f.seoDescription || null, faq: f.faq.filter((x) => x.q.trim() && x.a.trim()),
      });
      await reload();
      onChanged();
      ok(r.reviewReset ? t('knowledgeAdmin.saved_reset') : t('knowledgeAdmin.saved'));
    } catch (err) { fail(err); }
  }
  async function saveMeta(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      await api.put(`${base}/articles/${id}`, {
        divisionKey: meta.divisionKey, authorId: meta.authorId || null, featuredImageUrl: meta.imageUrl || null,
        featuredImageAltEn: meta.altEn || null, featuredImageAltFr: meta.altFr || null, aiAssisted: meta.ai, sourceNote: meta.source || null, relatedIds: meta.related,
      });
      await reload();
      onChanged();
      ok(t('knowledgeAdmin.saved'));
    } catch (err) { fail(err); }
  }
  async function review(approved: boolean) {
    setMsg(null);
    try { await api.post(`${base}/articles/${id}/translations/${lang}/review`, { approved }); await reload(); onChanged(); ok(approved ? t('knowledgeAdmin.approved_msg') : t('knowledgeAdmin.unapproved_msg')); } catch (err) { fail(err); }
  }
  async function move(to: Status) {
    setMsg(null);
    try { await api.post(`${base}/articles/${id}/status`, { to }); await reload(); onChanged(); ok(t(`knowledgeAdmin.moved.${to}`)); } catch (err) { fail(err); }
  }
  async function remove() {
    if (!window.confirm(t('knowledgeAdmin.delete_confirm') ?? '')) return;
    try { await api.delete(`${base}/articles/${id}`); onChanged(); onBack(); } catch (err) { fail(err); }
  }
  async function showPreview() {
    if (preview !== null) return setPreview(null);
    try { setPreview((await api.post<{ html: string }>(`${base}/preview`, { body: f.body })).html); } catch (err) { fail(err); }
  }

  const others = data.articles.filter((a) => a.id !== id);
  const label = (a: Article) => a.translations.find((x) => x.lang === uiLang)?.title || a.translations[0]?.title || t('knowledgeAdmin.untitled');

  return (
    <div className="space-y-4" data-testid="kc-editor">
      <button type="button" className="text-sm text-brand-700 underline" onClick={onBack}>← {t('knowledgeAdmin.back')}</button>

      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={art.status} />
          {art.publishedAt && <span className="text-xs text-slate-500">{t('knowledgeAdmin.published_on', { date: when(art.publishedAt) })}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          {NEXT[art.status].map((m) => (
            <button key={m.to} type="button" className={m.primary ? 'btn-primary' : 'btn-secondary'} onClick={() => move(m.to)}>{t(`knowledgeAdmin.move.${m.key}`)}</button>
          ))}
          {art.status !== 'PUBLISHED' && <button type="button" className="text-sm text-red-700 underline" onClick={remove}>{t('knowledgeAdmin.delete')}</button>}
        </div>
        <p className="text-xs text-slate-500">{t('knowledgeAdmin.stage_help')}</p>
        {msg && <p role="status" className={`text-sm font-medium ${msg.ok ? 'text-green-700' : 'text-red-700'}`}>{msg.text}</p>}
      </div>

      <div role="tablist" aria-label={t('knowledgeAdmin.language') ?? ''} className="flex gap-2">
        {LANGS.map((l) => {
          const x = art.translations.find((y) => y.lang === l);
          return (
            <button key={l} type="button" role="tab" aria-selected={lang === l} onClick={() => { setLang(l); setPreview(null); }}
              className={`rounded-full border px-4 py-1.5 text-sm font-semibold ${lang === l ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300 bg-white text-slate-700'}`}>
              {l === 'en' ? 'English' : 'Français'} {x?.reviewedAt ? '✓' : x ? '…' : ''}
            </button>
          );
        })}
      </div>

      <form onSubmit={saveTr} className="card space-y-3">
        <label className="label" htmlFor="kc-title">{t('knowledgeAdmin.f_title')}</label>
        <input id="kc-title" className="input" required maxLength={200} value={f.title} onChange={(e) => setF({ title: e.target.value })} />
        <label className="label" htmlFor="kc-summary">{t('knowledgeAdmin.f_summary')}</label>
        <textarea id="kc-summary" className="input" required rows={2} maxLength={500} value={f.summary} onChange={(e) => setF({ summary: e.target.value })} />
        <label className="label" htmlFor="kc-body">{t('knowledgeAdmin.f_body')}</label>
        <textarea id="kc-body" className="input font-serif" rows={16} maxLength={100000} value={f.body} onChange={(e) => setF({ body: e.target.value })} />
        <p className="text-xs text-slate-500">{t('knowledgeAdmin.body_help')}</p>
        <button type="button" className="btn-secondary" onClick={showPreview}>{preview === null ? t('knowledgeAdmin.preview') : t('knowledgeAdmin.hide_preview')}</button>
        {preview !== null && (
          // The text is turned into safe HTML by the server (typed HTML is shown as plain characters).
          <div className="rounded-lg border border-slate-200 bg-white p-4" data-testid="kc-preview" dangerouslySetInnerHTML={{ __html: preview }} />
        )}

        <details>
          <summary className="cursor-pointer text-sm font-semibold text-brand-900">{t('knowledgeAdmin.faq')}</summary>
          <div className="mt-2 space-y-2">
            {f.faq.map((q, i) => (
              <div key={i} className="space-y-1 rounded-lg border border-slate-200 p-2">
                <input className="input" aria-label={t('knowledgeAdmin.faq_q') ?? ''} placeholder={t('knowledgeAdmin.faq_q') ?? ''} value={q.q} onChange={(e) => setF({ faq: f.faq.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)) })} />
                <textarea className="input" rows={2} aria-label={t('knowledgeAdmin.faq_a') ?? ''} placeholder={t('knowledgeAdmin.faq_a') ?? ''} value={q.a} onChange={(e) => setF({ faq: f.faq.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)) })} />
                <button type="button" className="text-xs text-red-700 underline" onClick={() => setF({ faq: f.faq.filter((_, j) => j !== i) })}>{t('knowledgeAdmin.remove')}</button>
              </div>
            ))}
            {f.faq.length < 12 && <button type="button" className="text-sm text-brand-700 underline" onClick={() => setF({ faq: [...f.faq, { q: '', a: '' }] })}>＋ {t('knowledgeAdmin.faq_add')}</button>}
          </div>
        </details>

        <details>
          <summary className="cursor-pointer text-sm font-semibold text-brand-900">{t('knowledgeAdmin.seo')}</summary>
          <div className="mt-2 space-y-2">
            <label className="label" htmlFor="kc-slug">{t('knowledgeAdmin.f_slug')}</label>
            <input id="kc-slug" className="input font-mono text-sm" placeholder={t('knowledgeAdmin.f_slug_auto') ?? ''} value={f.slug} onChange={(e) => setF({ slug: e.target.value })} />
            <label className="label" htmlFor="kc-seo-title">{t('knowledgeAdmin.f_seo_title')}</label>
            <input id="kc-seo-title" className="input" maxLength={120} value={f.seoTitle} onChange={(e) => setF({ seoTitle: e.target.value })} />
            <label className="label" htmlFor="kc-seo-desc">{t('knowledgeAdmin.f_seo_desc')}</label>
            <textarea id="kc-seo-desc" className="input" rows={2} maxLength={300} value={f.seoDescription} onChange={(e) => setF({ seoDescription: e.target.value })} />
          </div>
        </details>

        <button type="submit" className="btn-primary">{t('knowledgeAdmin.save_version', { lang: lang.toUpperCase() })}</button>
      </form>

      {tr && (
        <div className="card space-y-2" data-testid="kc-review">
          <h3 className="text-sm font-semibold text-brand-900">{t('knowledgeAdmin.review_title', { lang: lang.toUpperCase() })}</h3>
          {tr.reviewedAt ? (
            <p className="text-sm text-green-800">✓ {t('knowledgeAdmin.reviewed_by', { who: tr.reviewedBy ?? '', date: when(tr.reviewedAt) })}</p>
          ) : (
            <p className="text-sm text-amber-800">{t('knowledgeAdmin.not_reviewed')}</p>
          )}
          <div className="flex flex-wrap gap-2">
            {!tr.reviewedAt && <button type="button" className="btn-primary" onClick={() => review(true)}>{t('knowledgeAdmin.approve_version', { lang: lang.toUpperCase() })}</button>}
            {tr.reviewedAt && <button type="button" className="btn-secondary" onClick={() => review(false)}>{t('knowledgeAdmin.take_back')}</button>}
            {tr.isPublic && tr.publicPath && <a className="btn-secondary" href={tr.publicPath} target="_blank" rel="noreferrer">{t('knowledgeAdmin.open_public')}</a>}
          </div>
          <p className="text-xs text-slate-500">{t('knowledgeAdmin.review_help')}</p>
        </div>
      )}

      <form onSubmit={saveMeta} className="card space-y-3">
        <h3 className="text-sm font-semibold text-brand-900">{t('knowledgeAdmin.details')}</h3>
        <label className="label" htmlFor="kc-area">{t('knowledgeAdmin.area')}</label>
        <select id="kc-area" className="input" value={meta.divisionKey} onChange={(e) => setMeta({ ...meta, divisionKey: e.target.value })}>
          {data.divisions.map((d) => <option key={d.key} value={d.key}>{d.name[uiLang]}</option>)}
        </select>
        <label className="label" htmlFor="kc-author">{t('knowledgeAdmin.author')}</label>
        <select id="kc-author" className="input" value={meta.authorId} onChange={(e) => setMeta({ ...meta, authorId: e.target.value })}>
          <option value="">{t('knowledgeAdmin.no_author')}</option>
          {data.authors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <label className="label" htmlFor="kc-img">{t('knowledgeAdmin.image_url')}</label>
        <input id="kc-img" className="input font-mono text-sm" placeholder="https://…" value={meta.imageUrl} onChange={(e) => setMeta({ ...meta, imageUrl: e.target.value })} />
        <p className="text-xs text-slate-500">{t('knowledgeAdmin.image_help')}</p>
        <label className="label" htmlFor="kc-alt-en">{t('knowledgeAdmin.alt_en')}</label>
        <input id="kc-alt-en" className="input" maxLength={300} value={meta.altEn} onChange={(e) => setMeta({ ...meta, altEn: e.target.value })} />
        <label className="label" htmlFor="kc-alt-fr">{t('knowledgeAdmin.alt_fr')}</label>
        <input id="kc-alt-fr" className="input" maxLength={300} value={meta.altFr} onChange={(e) => setMeta({ ...meta, altFr: e.target.value })} />
        <fieldset>
          <legend className="label">{t('knowledgeAdmin.related')}</legend>
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
            {others.length === 0 && <p className="text-xs text-slate-400">{t('knowledgeAdmin.none')}</p>}
            {others.map((o) => (
              <label key={o.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={meta.related.includes(o.id)} disabled={!meta.related.includes(o.id) && meta.related.length >= 6}
                  onChange={(e) => setMeta({ ...meta, related: e.target.checked ? [...meta.related, o.id] : meta.related.filter((x) => x !== o.id) })} />
                {label(o)}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={meta.ai} onChange={(e) => setMeta({ ...meta, ai: e.target.checked })} />
          {t('knowledgeAdmin.ai_assisted')}
        </label>
        <label className="label" htmlFor="kc-source">{t('knowledgeAdmin.source_note')}</label>
        <textarea id="kc-source" className="input" rows={2} maxLength={1000} value={meta.source} onChange={(e) => setMeta({ ...meta, source: e.target.value })} />
        <button type="submit" className="btn-primary">{t('knowledgeAdmin.save_details')}</button>
      </form>
    </div>
  );
}
