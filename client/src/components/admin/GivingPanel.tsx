import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';

interface Summary {
  confirmedTotal: number;
  confirmedCount: number;
  waitingCount: number;
  byKind: { kind: string; total: number; count: number }[];
  byAssembly: { communityId: string | null; name: string | null; total: number; count: number }[];
}
interface Waiting {
  id: string;
  giverName: string | null;
  assemblyName: string | null;
  kind: string;
  campaignTitle: string | null;
  amount: number;
  reference: string | null;
  payerPhone: string | null;
  anonymous: boolean;
  createdAt: string;
}
interface Campaign {
  id: string;
  titleEn: string;
  titleFr: string | null;
  targetAmount: number | null;
  status: 'OPEN' | 'CLOSED';
  raised: number;
  giftCount: number;
}
interface Report {
  campaign: Campaign;
  gifts: { id: string; name: string | null; amount: number; date: string }[];
}

const fcfa = (n: number) => `${n.toLocaleString('fr-FR')} FCFA`;

// The central admin's giving desk: gifts waiting to be confirmed, the totals
// (overall, by kind and per assembly — never shown to leaders), the
// help-one-another campaigns and how to give. The same panel is shown in the
// admin dashboard and in the central admin's own member profile; only the
// address differs (`base`).
export function GivingPanel({ base }: { base: '/api/admin/giving' | '/api/member/central-giving' }) {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [waiting, setWaiting] = useState<Waiting[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [instr, setInstr] = useState<{ en: string; fr: string; weeklyPost: boolean } | null>(null);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({ titleEn: '', titleFr: '', descriptionEn: '', descriptionFr: '', targetAmount: '' });

  function load() {
    Promise.all([
      api.get<Summary>(`${base}/summary`),
      api.get<{ items: Waiting[] }>(`${base}/waiting`),
      api.get<{ items: Campaign[] }>(`${base}/campaigns`),
      api.get<{ en: string; fr: string; weeklyPost: boolean }>(`${base}/instructions`),
    ])
      .then(([s, w, c, i]) => {
        setSummary(s);
        setWaiting(w.items);
        setCampaigns(c.items);
        setInstr((cur) => cur ?? i);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }
  useEffect(load, [base]);

  const fail = (err: unknown) => setMessage({ kind: 'error', text: err instanceof ApiError ? err.message : t('givingAdmin.failed') });

  async function decide(id: string, decision: 'CONFIRM' | 'REJECT') {
    setBusy(id);
    setMessage(null);
    try {
      await api.post(`${base}/gifts/${id}/decide`, { decision });
      setMessage({ kind: 'ok', text: decision === 'CONFIRM' ? t('givingAdmin.confirmed') : t('givingAdmin.rejected') });
      load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }

  async function createCampaign(e: React.FormEvent) {
    e.preventDefault();
    setBusy('campaign');
    setMessage(null);
    try {
      await api.post(`${base}/campaigns`, {
        titleEn: form.titleEn.trim(),
        ...(form.titleFr.trim() ? { titleFr: form.titleFr.trim() } : {}),
        ...(form.descriptionEn.trim() ? { descriptionEn: form.descriptionEn.trim() } : {}),
        ...(form.descriptionFr.trim() ? { descriptionFr: form.descriptionFr.trim() } : {}),
        ...(form.targetAmount ? { targetAmount: Number(form.targetAmount) } : {}),
      });
      setForm({ titleEn: '', titleFr: '', descriptionEn: '', descriptionFr: '', targetAmount: '' });
      setMessage({ kind: 'ok', text: t('givingAdmin.campaign_created') });
      load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }

  async function closeCampaign(id: string) {
    setBusy(id);
    try {
      await api.patch(`${base}/campaigns/${id}/close`, {});
      load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }

  async function saveInstructions() {
    if (!instr) return;
    setBusy('instructions');
    setMessage(null);
    try {
      await api.put(`${base}/instructions`, instr);
      setMessage({ kind: 'ok', text: t('givingAdmin.instructions_saved') });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }

  if (failed) return <p className="card text-sm text-red-700">{t('givingAdmin.load_failed')}</p>;
  if (!summary) return <p className="py-6 text-center text-sm text-slate-400">{t('common.loading')}</p>;

  return (
    <div className="space-y-4" data-testid="giving-panel">
      <section className="card space-y-2">
        <h2 className="font-semibold text-brand-900">{t('givingAdmin.title')}</h2>
        <p className="text-sm text-slate-600">{t('givingAdmin.intro')}</p>
        <p className="text-lg font-semibold text-slate-900">{t('givingAdmin.total', { amount: fcfa(summary.confirmedTotal), count: summary.confirmedCount })}</p>
        <ul className="flex flex-wrap gap-2 text-sm">
          {summary.byKind.map((k) => (
            <li key={k.kind} className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
              {t(`giving.kind_${k.kind.toLowerCase()}`)}: {fcfa(k.total)}
            </li>
          ))}
        </ul>
        {summary.byAssembly.length > 0 && (
          <div>
            <h3 className="mt-2 text-sm font-medium text-slate-800">{t('givingAdmin.per_assembly')}</h3>
            <ul className="divide-y divide-slate-100 text-sm">
              {summary.byAssembly.map((a) => (
                <li key={a.communityId ?? 'none'} className="flex justify-between gap-2 py-1">
                  <span>{a.name ?? t('givingAdmin.no_assembly')}</span>
                  <span className="text-slate-700">{fcfa(a.total)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {message && (
        <p role={message.kind === 'error' ? 'alert' : 'status'} className={`rounded-lg px-3 py-2 text-sm ${message.kind === 'error' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {message.text}
        </p>
      )}

      <section className="card space-y-2">
        <h3 className="font-semibold text-brand-900">{t('givingAdmin.waiting_title', { count: waiting.length })}</h3>
        {waiting.length === 0 && <p className="text-sm text-slate-500">{t('givingAdmin.waiting_none')}</p>}
        <ul className="space-y-2">
          {waiting.map((w) => (
            <li key={w.id} className="space-y-1 rounded-xl border border-slate-200 p-3 text-sm">
              <p className="font-medium text-slate-900">
                {w.giverName ?? t('givingAdmin.unknown_giver')} · {fcfa(w.amount)}
              </p>
              <p className="text-slate-600">
                {w.campaignTitle ? `${t('giving.kind_campaign')}: ${w.campaignTitle}` : t(`giving.kind_${w.kind.toLowerCase()}`)}
                {w.assemblyName ? ` · ${w.assemblyName}` : ''}
                {w.anonymous ? ` · ${t('givingAdmin.wants_anonymous')}` : ''}
              </p>
              <p className="text-xs text-slate-500">
                {t('givingAdmin.reference', { ref: w.reference ?? '—' })}
                {w.payerPhone ? ` · ${w.payerPhone}` : ''} · {new Date(w.createdAt).toLocaleString()}
              </p>
              <div className="flex gap-2 pt-1">
                <button type="button" className="btn-primary px-3 py-1.5 text-sm" disabled={busy === w.id} onClick={() => decide(w.id, 'CONFIRM')}>
                  {t('givingAdmin.confirm')}
                </button>
                <button type="button" className="btn-secondary px-3 py-1.5 text-sm" disabled={busy === w.id} onClick={() => decide(w.id, 'REJECT')}>
                  {t('givingAdmin.reject')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="card space-y-3">
        <h3 className="font-semibold text-brand-900">{t('givingAdmin.campaigns_title')}</h3>
        <ul className="space-y-2">
          {campaigns.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3 text-sm">
              <span>
                <span className="font-medium text-slate-900">{c.titleEn}</span>
                <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${c.status === 'OPEN' ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600'}`}>{t(`givingAdmin.campaign_${c.status.toLowerCase()}`)}</span>
                <span className="block text-xs text-slate-500">
                  {fcfa(c.raised)}
                  {c.targetAmount ? ` / ${fcfa(c.targetAmount)}` : ''} · {t('givingAdmin.gift_count', { count: c.giftCount })}
                </span>
              </span>
              <span className="flex gap-2">
                <button type="button" className="btn-secondary px-3 py-1 text-sm" onClick={async () => setReport(await api.get<Report>(`${base}/campaigns/${c.id}/report`).catch(() => null))}>
                  {t('givingAdmin.report')}
                </button>
                {c.status === 'OPEN' && (
                  <button type="button" className="btn-secondary px-3 py-1 text-sm" disabled={busy === c.id} onClick={() => closeCampaign(c.id)}>
                    {t('givingAdmin.close')}
                  </button>
                )}
              </span>
            </li>
          ))}
          {campaigns.length === 0 && <li className="text-sm text-slate-500">{t('givingAdmin.campaigns_none')}</li>}
        </ul>
        {report && (
          <div className="rounded-xl bg-slate-50 p-3 text-sm" data-testid="admin-campaign-report">
            <p className="font-medium text-slate-900">{t('givingAdmin.report_for', { title: report.campaign.titleEn })}</p>
            <ul className="divide-y divide-slate-200">
              {report.gifts.map((g) => (
                <li key={g.id} className="flex justify-between gap-2 py-1">
                  <span>{g.name ?? t('giving.anonymous_name')}</span>
                  <span>{fcfa(g.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <form onSubmit={createCampaign} className="space-y-2 border-t border-slate-200 pt-3">
          <h4 className="font-medium text-slate-800">{t('givingAdmin.new_campaign')}</h4>
          <input className="input" aria-label={t('givingAdmin.title_en')} placeholder={t('givingAdmin.title_en') ?? ''} required maxLength={200} value={form.titleEn} onChange={(e) => setForm({ ...form, titleEn: e.target.value })} />
          <input className="input" aria-label={t('givingAdmin.title_fr')} placeholder={t('givingAdmin.title_fr') ?? ''} maxLength={200} value={form.titleFr} onChange={(e) => setForm({ ...form, titleFr: e.target.value })} />
          <textarea className="input" rows={2} aria-label={t('givingAdmin.description_en')} placeholder={t('givingAdmin.description_en') ?? ''} value={form.descriptionEn} onChange={(e) => setForm({ ...form, descriptionEn: e.target.value })} />
          <textarea className="input" rows={2} aria-label={t('givingAdmin.description_fr')} placeholder={t('givingAdmin.description_fr') ?? ''} value={form.descriptionFr} onChange={(e) => setForm({ ...form, descriptionFr: e.target.value })} />
          <input className="input" type="number" min={100} aria-label={t('givingAdmin.target')} placeholder={t('givingAdmin.target') ?? ''} value={form.targetAmount} onChange={(e) => setForm({ ...form, targetAmount: e.target.value })} />
          <button className="btn-primary" disabled={busy === 'campaign' || !form.titleEn.trim()}>{t('givingAdmin.create_campaign')}</button>
        </form>
      </section>

      {instr && (
        <section className="card space-y-2">
          <h3 className="font-semibold text-brand-900">{t('givingAdmin.instructions_title')}</h3>
          <p className="text-sm text-slate-600">{t('givingAdmin.instructions_help')}</p>
          <label className="label" htmlFor="giving-instr-en">{t('givingAdmin.instructions_en')}</label>
          <textarea id="giving-instr-en" className="input" rows={3} value={instr.en} onChange={(e) => setInstr({ ...instr, en: e.target.value })} />
          <label className="label" htmlFor="giving-instr-fr">{t('givingAdmin.instructions_fr')}</label>
          <textarea id="giving-instr-fr" className="input" rows={3} value={instr.fr} onChange={(e) => setInstr({ ...instr, fr: e.target.value })} />
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={instr.weeklyPost} onChange={(e) => setInstr({ ...instr, weeklyPost: e.target.checked })} />
            {t('givingAdmin.weekly_post')}
          </label>
          <button type="button" className="btn-secondary" disabled={busy === 'instructions'} onClick={saveInstructions}>{t('givingAdmin.save')}</button>
        </section>
      )}
    </div>
  );
}
