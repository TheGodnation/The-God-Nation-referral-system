import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { NotificationBell } from '../components/NotificationBell';
import { MemberNav } from '../components/member/MemberNav';
import { api, ApiError } from '../lib/api';

type Kind = 'OFFERING' | 'TITHE' | 'FREE_WILL' | 'CAMPAIGN' | 'SEED_FAITH' | 'THANKSGIVING' | 'FIRST_FRUITS' | 'OTHER';

// What a gift can be for, in the order they are listed (a campaign is added when one is open).
const KINDS: Kind[] = ['OFFERING', 'TITHE', 'SEED_FAITH', 'THANKSGIVING', 'FIRST_FRUITS', 'FREE_WILL', 'OTHER'];

interface Campaign {
  id: string;
  titleEn: string;
  titleFr: string | null;
  descriptionEn: string | null;
  descriptionFr: string | null;
  targetAmount: number | null;
  raised: number;
  giftCount: number;
}
interface Info {
  instructions: string;
  minimum: number;
  maximum: number;
  campaigns: Campaign[];
  mine: { id: string; kind: Kind; campaignTitleEn: string | null; campaignTitleFr: string | null; amount: number; status: 'CLAIMED' | 'CONFIRMED' | 'REJECTED'; anonymous: boolean; createdAt: string }[];
}
interface Report {
  campaign: Campaign;
  gifts: { id: string; name: string | null; amount: number; date: string }[];
}

const fcfa = (n: number) => `${n.toLocaleString('fr-FR')} FCFA`;

// "Give": how to give, "Contact to Receive Confirmation" once a gift has been
// made, the help-one-another campaigns with their public reports, and the
// member's own gifts.
export function MemberGivePage() {
  const { t, i18n } = useTranslation();
  const isFr = i18n.language.startsWith('fr');
  const [info, setInfo] = useState<Info | null>(null);
  const [failed, setFailed] = useState(false);
  const [kind, setKind] = useState<Kind>('OFFERING');
  const [campaignId, setCampaignId] = useState('');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [phone, setPhone] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [report, setReport] = useState<Report | null>(null);

  function load() {
    api
      .get<Info>('/api/member/giving/info')
      .then((r) => {
        setInfo(r);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }
  useEffect(load, []);

  const title = (c: { titleEn: string; titleFr: string | null }) => (isFr ? c.titleFr || c.titleEn : c.titleEn);
  const describe = (c: Campaign) => (isFr ? c.descriptionFr || c.descriptionEn : c.descriptionEn);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await api.post('/api/member/giving/gifts', {
        kind,
        ...(kind === 'CAMPAIGN' ? { campaignId, anonymous } : {}),
        amount: Number(amount),
        reference: reference.trim(),
        ...(phone.trim() ? { payerPhone: phone.trim() } : {}),
      });
      setMessage({ kind: 'ok', text: t('giving.sent') });
      setAmount('');
      setReference('');
      setPhone('');
      load();
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof ApiError ? err.message : t('giving.failed') });
    } finally {
      setBusy(false);
    }
  }

  async function openReport(id: string) {
    setReport(null);
    try {
      setReport(await api.get<Report>(`/api/member/giving/campaigns/${encodeURIComponent(id)}/report`));
    } catch {
      setMessage({ kind: 'error', text: t('giving.failed') });
    }
  }

  const kindLabel = (k: Kind) => t(`giving.kind_${k.toLowerCase()}`);

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-2xl space-y-4 px-4 py-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-brand-900">{t('giving.title')}</h1>
          <NotificationBell />
        </div>
        <div className="space-y-2 text-sm text-slate-700">
          <p>{t('giving.intro')}</p>
          <p className="font-medium text-brand-900">{t('giving.intro2')}</p>
        </div>
        {failed && <p className="card text-sm text-red-700">{t('giving.load_failed')}</p>}
        {!info && !failed && <p className="py-6 text-center text-sm text-slate-400">{t('common.loading')}</p>}

        {info && (
          <>
            <section className="card space-y-2">
              <h2 className="font-semibold text-brand-900">{t('giving.how_title')}</h2>
              <p className="text-sm text-slate-600">{t('giving.how_intro')}</p>
              {info.instructions ? <p className="whitespace-pre-line text-slate-800">{info.instructions}</p> : <p className="text-sm text-slate-500">{t('giving.no_instructions')}</p>}
              <p className="text-xs text-slate-500">{t('giving.privacy_note')}</p>
            </section>

            <form onSubmit={submit} className="card space-y-3">
              <h2 className="font-semibold text-brand-900">{t('giving.said_title')}</h2>
              <div>
                <label className="label" htmlFor="gift-kind">{t('giving.what_for')}</label>
                <select id="gift-kind" className="input" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
                  {KINDS.map((k) => (
                    <option key={k} value={k}>{kindLabel(k)}</option>
                  ))}
                  {info.campaigns.length > 0 && <option value="CAMPAIGN">{kindLabel('CAMPAIGN')}</option>}
                </select>
                {kind === 'FREE_WILL' && <p className="mt-1 text-xs text-slate-500">{t('giving.free_will_help')}</p>}
              </div>
              {kind === 'CAMPAIGN' && (
                <div>
                  <label className="label" htmlFor="gift-campaign">{t('giving.which_campaign')}</label>
                  <select id="gift-campaign" className="input" value={campaignId} onChange={(e) => setCampaignId(e.target.value)} required>
                    <option value="">{t('giving.choose')}</option>
                    {info.campaigns.map((c) => (
                      <option key={c.id} value={c.id}>{title(c)}</option>
                    ))}
                  </select>
                  <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
                    {t('giving.anonymous')}
                  </label>
                  <p className="text-xs text-slate-500">{t('giving.anonymous_help')}</p>
                </div>
              )}
              <div>
                <label className="label" htmlFor="gift-amount">{t('giving.amount')}</label>
                <input id="gift-amount" className="input" type="number" inputMode="numeric" min={info.minimum} max={info.maximum} required value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="gift-reference">{t('giving.reference')}</label>
                <input id="gift-reference" className="input" required minLength={3} maxLength={100} value={reference} onChange={(e) => setReference(e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="gift-phone">{t('giving.phone')}</label>
                <input id="gift-phone" className="input" inputMode="tel" maxLength={30} value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              {message && (
                <p role={message.kind === 'error' ? 'alert' : 'status'} className={`rounded-lg px-3 py-2 text-sm ${message.kind === 'error' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                  {message.text}
                </p>
              )}
              <button className="btn-primary" disabled={busy || (kind === 'CAMPAIGN' && !campaignId)}>
                {t('giving.send')}
              </button>
              <p className="text-xs text-slate-500">{t('giving.send_help')}</p>
            </form>

            {info.campaigns.length > 0 && (
              <section className="card space-y-3">
                <h2 className="font-semibold text-brand-900">{t('giving.campaigns_title')}</h2>
                <ul className="space-y-3">
                  {info.campaigns.map((c) => (
                    <li key={c.id} className="space-y-1 rounded-xl border border-slate-200 p-3">
                      <p className="font-medium text-slate-900">{title(c)}</p>
                      {describe(c) && <p className="text-sm text-slate-600">{describe(c)}</p>}
                      <p className="text-sm text-slate-700">
                        {fcfa(c.raised)}
                        {c.targetAmount ? ` / ${fcfa(c.targetAmount)}` : ''}
                      </p>
                      {c.targetAmount ? (
                        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden>
                          <div className="h-full bg-brand-600" style={{ width: `${Math.min(100, Math.round((c.raised / c.targetAmount) * 100))}%` }} />
                        </div>
                      ) : null}
                      <button type="button" className="text-sm text-brand-700 underline" onClick={() => openReport(c.id)}>
                        {t('giving.see_report')}
                      </button>
                    </li>
                  ))}
                </ul>
                {report && (
                  <div className="space-y-2 rounded-xl bg-slate-50 p-3" data-testid="campaign-report">
                    <h3 className="font-medium text-slate-900">{t('giving.report_title', { title: title(report.campaign) })}</h3>
                    {report.gifts.length === 0 && <p className="text-sm text-slate-500">{t('giving.report_empty')}</p>}
                    <ul className="divide-y divide-slate-200 text-sm">
                      {report.gifts.map((g) => (
                        <li key={g.id} className="flex justify-between gap-2 py-1">
                          <span>{g.name ?? t('giving.anonymous_name')}</span>
                          <span className="text-slate-700">{fcfa(g.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            )}

            <section className="card space-y-2">
              <h2 className="font-semibold text-brand-900">{t('giving.mine_title')}</h2>
              {info.mine.length === 0 && <p className="text-sm text-slate-500">{t('giving.mine_empty')}</p>}
              <ul className="divide-y divide-slate-100 text-sm">
                {info.mine.map((g) => (
                  <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      {g.kind === 'CAMPAIGN' ? (isFr ? g.campaignTitleFr || g.campaignTitleEn : g.campaignTitleEn) : kindLabel(g.kind)}
                      <span className="block text-xs text-slate-500">{new Date(g.createdAt).toLocaleDateString()}</span>
                    </span>
                    <span className="text-right">
                      {fcfa(g.amount)}
                      <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${g.status === 'CONFIRMED' ? 'bg-green-100 text-green-800' : g.status === 'REJECTED' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-900'}`}>
                        {t(`giving.status_${g.status.toLowerCase()}`)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}

        <p className="text-center text-sm">
          <Link to="/member/me" className="text-brand-700 underline">{t('giving.back')}</Link>
        </p>
        <MemberNav />
      </section>
    </PageShell>
  );
}
