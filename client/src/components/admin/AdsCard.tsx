import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';

interface Summary {
  ids: { metaPixelId: string | null; tiktokPixelId: string | null; googleTagId: string | null; googleLeadSendTo: string | null; googleSignupSendTo: string | null };
  meta: { tokenSet: boolean; testMode: boolean; serverReady: boolean };
  tiktok: { tokenSet: boolean; testMode: boolean; serverReady: boolean };
  last7: { ok: number; failed: number };
  recent: { id: string; platform: string; event: string; ok: boolean; status: number | null; error: string | null; createdAt: string }[];
  audiences: { members: number; quiet: number; quietDays: number };
}

type IdKey = keyof Summary['ids'];
const FIELDS: { key: IdKey; label: string; example: string }[] = [
  { key: 'metaPixelId', label: 'ads.meta_pixel', example: '1234567890123456' },
  { key: 'tiktokPixelId', label: 'ads.tiktok_pixel', example: 'C1ABCDEF2GHIJKL3MNOP' },
  { key: 'googleTagId', label: 'ads.google_tag', example: 'AW-123456789' },
  { key: 'googleLeadSendTo', label: 'ads.google_lead', example: 'AW-123456789/AbCdEfGhIj' },
  { key: 'googleSignupSendTo', label: 'ads.google_signup', example: 'AW-123456789/KlMnOpQrSt' },
];

// The central admin's "Ads connections" card: public pixel / tag ids, whether the secret
// tokens are set on the server, what was recently sent, and the scrambled member lists.
// Everything stays off until an id is entered; browser tools also wait for each visitor's "Allow".
export function AdsCard({ base }: { base: string }) {
  const { t } = useTranslation();
  const [s, setS] = useState<Summary | null>(null);
  const [form, setForm] = useState<Record<IdKey, string>>({ metaPixelId: '', tiktokPixelId: '', googleTagId: '', googleLeadSendTo: '', googleSignupSendTo: '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function load(r: Summary) {
    setS(r);
    setForm({
      metaPixelId: r.ids.metaPixelId ?? '',
      tiktokPixelId: r.ids.tiktokPixelId ?? '',
      googleTagId: r.ids.googleTagId ?? '',
      googleLeadSendTo: r.ids.googleLeadSendTo ?? '',
      googleSignupSendTo: r.ids.googleSignupSendTo ?? '',
    });
  }

  useEffect(() => {
    api.get<Summary>(base).then(load).catch(() => {});
  }, [base]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      load(await api.put<Summary>(base, form));
      setMsg({ ok: true, text: t('ads.saved') });
    } catch {
      setMsg({ ok: false, text: t('ads.failed') });
    }
  }

  if (!s) return null;

  const status = (label: string, p: Summary['meta'], pixel: string | null) => (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-medium text-slate-800">{label}</span>
      <span className={`rounded-full px-2 py-0.5 text-xs ${pixel ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600'}`}>{pixel ? t('ads.pixel_set') : t('ads.pixel_missing')}</span>
      <span className={`rounded-full px-2 py-0.5 text-xs ${p.tokenSet ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600'}`}>{p.tokenSet ? t('ads.token_set') : t('ads.token_missing')}</span>
      {p.serverReady && <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800">{t('ads.server_ready')}</span>}
      {p.testMode && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">{t('ads.test_mode')}</span>}
    </li>
  );

  return (
    <div className="card space-y-4" data-testid="ads-card">
      <div>
        <h2 className="font-semibold text-brand-900">{t('ads.title')}</h2>
        <p className="text-xs text-slate-500">{t('ads.help')}</p>
        <p role="note" className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{t('ads.untested')}</p>
      </div>

      <form onSubmit={save} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <div key={f.key}>
              <label className="label" htmlFor={`ads-${f.key}`}>{t(f.label)}</label>
              <input
                id={`ads-${f.key}`}
                className="input font-mono text-sm"
                value={form[f.key]}
                placeholder={f.example}
                autoComplete="off"
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
              />
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-500">{t('ads.ids_hint')}</p>
        <button type="submit" className="btn-primary">{t('ads.save')}</button>
        {msg && <p role="status" className={`text-sm font-medium ${msg.ok ? 'text-green-700' : 'text-red-700'}`}>{msg.text}</p>}
      </form>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-brand-900">{t('ads.status')}</h3>
        <ul className="space-y-1">
          {status('Meta (Facebook, Instagram)', s.meta, s.ids.metaPixelId)}
          {status('TikTok', s.tiktok, s.ids.tiktokPixelId)}
        </ul>
        <p className="text-xs text-slate-500">{t('ads.tokens_hint')}</p>
        <p className="text-sm text-slate-700" data-testid="ads-last7">{t('ads.last7', { ok: s.last7.ok, failed: s.last7.failed })}</p>
        {s.recent.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-slate-400">
                  <th className="py-1 pr-3">{t('ads.col_when')}</th>
                  <th className="py-1 pr-3">{t('ads.col_platform')}</th>
                  <th className="py-1 pr-3">{t('ads.col_event')}</th>
                  <th className="py-1 pr-3">{t('ads.col_result')}</th>
                </tr>
              </thead>
              <tbody>
                {s.recent.map((r) => (
                  <tr key={r.id} className="border-b border-slate-50">
                    <td className="py-1 pr-3">{new Date(r.createdAt).toLocaleString()}</td>
                    <td className="py-1 pr-3">{r.platform}</td>
                    <td className="py-1 pr-3">{r.event}</td>
                    <td className={`py-1 pr-3 ${r.ok ? 'text-green-700' : 'text-red-700'}`}>{r.ok ? t('ads.ok') : `${t('ads.failed_row')}${r.status ? ` (${r.status})` : ''}${r.error ? `: ${r.error}` : ''}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-brand-900">{t('ads.lists_title')}</h3>
        <p className="text-xs text-slate-500">{t('ads.lists_help')}</p>
        <div className="flex flex-wrap gap-2">
          <a className="btn-secondary" href={`${base}/audience.csv?kind=members`} download data-testid="ads-download-members">
            {t('ads.download_members', { n: s.audiences.members })}
          </a>
          <a className="btn-secondary" href={`${base}/audience.csv?kind=quiet`} download data-testid="ads-download-quiet">
            {t('ads.download_quiet', { n: s.audiences.quiet, days: s.audiences.quietDays })}
          </a>
        </div>
      </div>
    </div>
  );
}
