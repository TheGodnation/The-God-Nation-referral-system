import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/AuthContext';

type Tab = 'overview' | 'leaders' | 'registrations' | 'settings' | 'content' | 'audit';

interface Overview {
  totalVisits: number;
  uniqueVisitors: number;
  registrations: number;
  whatsappClicks: number;
  activeLeaders: number;
  conversionRate: number;
}

interface LeaderRow {
  id: string;
  name: string;
  email: string;
  active: boolean;
  isTestData: boolean;
  referralCode: string | null;
  createdAt: string;
}

interface RegistrationRow {
  id: string;
  name: string;
  whatsapp: string;
  language: string;
  leader: { id: string; name: string } | null;
  createdAt: string;
  isTestData: boolean;
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
        active ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
      }`}
    >
      {children}
    </button>
  );
}

function OverviewTab({ includeTestData }: { includeTestData: boolean }) {
  const { t } = useTranslation();
  const [data, setData] = useState<Overview | null>(null);

  useEffect(() => {
    api.get<Overview>(`/api/admin/dashboard?includeTestData=${includeTestData}`).then(setData);
  }, [includeTestData]);

  if (!data) return <p className="text-slate-400">{t('admin.loading')}</p>;

  return (
    <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
      {[
        [t('admin.overview.total_visits'), data.totalVisits],
        [t('admin.overview.unique_visitors'), data.uniqueVisitors],
        [t('admin.overview.registrations'), data.registrations],
        [t('admin.overview.whatsapp_clicks'), data.whatsappClicks],
        [t('admin.overview.active_leaders'), data.activeLeaders],
        [t('admin.overview.conversion'), `${data.conversionRate}%`],
      ].map(([label, value]) => (
        <div key={label as string} className="card">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
          <p className="mt-1 text-2xl font-bold text-brand-900">{value}</p>
        </div>
      ))}
    </div>
  );
}

function LeadersTab() {
  const { t } = useTranslation();
  const [items, setItems] = useState<LeaderRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ email: string; invitationSent: boolean } | null>(null);
  const [resendStatus, setResendStatus] = useState<Record<string, string>>({});

  function load() {
    api.get<{ items: LeaderRow[] }>('/api/admin/leaders?pageSize=100').then((res) => setItems(res.items));
  }

  useEffect(load, []);

  async function createLeader(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await api.post<{ email: string; invitationSent: boolean }>('/api/admin/leaders', {
        name,
        email,
        referralCode: code,
      });
      setCreated(res);
      setName('');
      setEmail('');
      setCode('');
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('admin.leaders.create_failed'));
    }
  }

  async function toggleActive(leader: LeaderRow) {
    await api.patch(`/api/admin/leaders/${leader.id}`, { active: !leader.active });
    load();
  }

  // Section 32: recovery when a Leader never received/lost/let expire
  // their invitation. Never sets or reveals a password directly.
  async function resendInvitation(leader: LeaderRow) {
    setResendStatus((s) => ({ ...s, [leader.id]: t('admin.leaders.resend_sending') }));
    try {
      const res = await api.post<{ invitationSent: boolean }>(`/api/admin/leaders/${leader.id}/resend-invitation`);
      setResendStatus((s) => ({
        ...s,
        [leader.id]: res.invitationSent ? t('admin.leaders.resend_sent') : t('admin.leaders.resend_failed'),
      }));
    } catch {
      setResendStatus((s) => ({ ...s, [leader.id]: t('admin.leaders.resend_failed') }));
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold text-brand-900">{t('admin.leaders.title')}</h2>
        <button className="btn-primary px-4 py-2" onClick={() => setShowForm((v) => !v)}>
          {t('admin.leaders.new_leader')}
        </button>
      </div>

      {created && (
        <div className="card mb-4 border-green-200 bg-green-50">
          <p className="text-sm text-green-800">
            {created.invitationSent
              ? t('admin.leaders.created_with_email', { email: created.email })
              : t('admin.leaders.created_email_failed', { email: created.email })}
          </p>
        </div>
      )}

      {showForm && (
        <form onSubmit={createLeader} className="card mb-4 space-y-3">
          <input
            className="input"
            placeholder={t('admin.leaders.name_placeholder') ?? ''}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <input
            className="input"
            type="email"
            placeholder={t('admin.leaders.email_placeholder') ?? ''}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="input"
            placeholder={t('admin.leaders.code_placeholder') ?? ''}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
          {error && <p className="text-sm text-red-700">{error}</p>}
          <button className="btn-primary" type="submit">
            {t('admin.leaders.create_leader')}
          </button>
        </form>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[600px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-slate-400">
              {/* Sticky-LEFT and first in row order, not last/sticky-right:
                  a sticky column pinned to the trailing edge of a row wider
                  than the screen renders on top of whichever columns are
                  still naturally visible at scroll position 0, hiding them
                  completely (that's what happened here before). Pinning the
                  first column instead never overlaps anything — it already
                  sits exactly where it would without scrolling, and later
                  columns simply scroll underneath/past it as normal. */}
              <th className="sticky left-0 z-10 bg-white py-2 pr-4 shadow-[8px_0_8px_-8px_rgba(0,0,0,0.1)]">
                {t('admin.leaders.table_action')}
              </th>
              <th className="py-2 pr-4">{t('admin.leaders.table_name')}</th>
              <th className="py-2 pr-4">{t('admin.leaders.table_email')}</th>
              <th className="py-2 pr-4">{t('admin.leaders.table_code')}</th>
              <th className="py-2 pr-4">{t('admin.leaders.table_status')}</th>
              <th className="py-2 pr-4">{t('admin.leaders.table_test')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((l) => (
              <tr key={l.id} className="border-b border-slate-50">
                <td className="sticky left-0 z-10 flex flex-col items-start gap-1 bg-white py-2 pr-4 shadow-[8px_0_8px_-8px_rgba(0,0,0,0.1)]">
                  <button className="text-brand-700 hover:underline" onClick={() => toggleActive(l)}>
                    {l.active ? t('admin.leaders.deactivate') : t('admin.leaders.activate')}
                  </button>
                  <button className="text-brand-700 hover:underline" onClick={() => resendInvitation(l)}>
                    {resendStatus[l.id] ?? t('admin.leaders.resend_invitation')}
                  </button>
                </td>
                <td className="py-2 pr-4">{l.name}</td>
                <td className="py-2 pr-4">{l.email}</td>
                <td className="py-2 pr-4">{l.referralCode ?? '—'}</td>
                <td className="py-2 pr-4">
                  {l.active ? t('admin.leaders.status_active') : t('admin.leaders.status_inactive')}
                </td>
                <td className="py-2 pr-4">{l.isTestData ? t('admin.leaders.yes') : t('admin.leaders.no')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RegistrationsTab({ includeTestData }: { includeTestData: boolean }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<RegistrationRow[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api
      .get<{ items: RegistrationRow[]; pagination: { totalPages: number } }>(
        `/api/admin/registrations?page=${page}&pageSize=20&includeTestData=${includeTestData}`,
      )
      .then((res) => {
        setItems(res.items);
        setTotalPages(res.pagination.totalPages);
      });
  }

  useEffect(load, [page, includeTestData]);

  // Freeing a WhatsApp number for re-registration requires actually
  // deleting the row (normalizedWhatsApp is a hard unique constraint) —
  // confirm first since this is permanent and cannot be undone.
  async function deleteRegistration(r: RegistrationRow) {
    if (!window.confirm(t('admin.registrations.delete_confirm', { name: r.name, whatsapp: r.whatsapp }))) {
      return;
    }
    setError(null);
    try {
      await api.delete(`/api/admin/registrations/${r.id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('admin.registrations.delete_failed'));
    }
  }

  return (
    <div className="card overflow-x-auto">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold text-brand-900">{t('admin.registrations.title')}</h2>
        <a className="text-sm text-brand-700 hover:underline" href="/api/admin/export">
          {t('admin.registrations.export_csv')}
        </a>
      </div>
      {error && <p className="mb-3 text-sm text-red-700">{error}</p>}
      <table className="w-full min-w-[700px] text-left text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-slate-400">
            {/* Sticky-LEFT and first in row order, not last/sticky-right:
                a sticky column pinned to the trailing edge of a row wider
                than the screen renders on top of whichever columns are
                still naturally visible at scroll position 0, hiding them
                completely (that's what happened here before — Language,
                Leader and Date all disappeared behind the Delete column).
                Pinning the first column instead never overlaps anything. */}
            <th className="sticky left-0 z-10 bg-white py-2 pr-4 shadow-[8px_0_8px_-8px_rgba(0,0,0,0.1)]">
              {t('admin.registrations.table_action')}
            </th>
            <th className="py-2 pr-4">{t('admin.registrations.table_name')}</th>
            <th className="py-2 pr-4">{t('admin.registrations.table_whatsapp')}</th>
            <th className="py-2 pr-4">{t('admin.registrations.table_language')}</th>
            <th className="py-2 pr-4">{t('admin.registrations.table_leader')}</th>
            <th className="py-2 pr-4">{t('admin.registrations.table_date')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.id} className="border-b border-slate-50">
              <td className="sticky left-0 z-10 bg-white py-2 pr-4 shadow-[8px_0_8px_-8px_rgba(0,0,0,0.1)]">
                <button className="text-red-700 hover:underline" onClick={() => deleteRegistration(r)}>
                  {t('admin.registrations.delete')}
                </button>
              </td>
              <td className="py-2 pr-4">{r.name}</td>
              <td className="py-2 pr-4">{r.whatsapp}</td>
              <td className="py-2 pr-4 uppercase">{r.language}</td>
              <td className="py-2 pr-4">{r.leader?.name ?? t('admin.registrations.direct')}</td>
              <td className="py-2 pr-4">{new Date(r.createdAt).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <button className="btn-secondary px-3 py-1.5" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {t('admin.prev')}
          </button>
          <span>{t('admin.page_of', { page, total: totalPages })}</span>
          <button
            className="btn-secondary px-3 py-1.5"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            {t('admin.next')}
          </button>
        </div>
      )}
    </div>
  );
}

interface SettingsData {
  whatsappUrlEn: string | null;
  whatsappUrlFr: string | null;
  whatsappUrlDiscoverEn: string | null;
  whatsappUrlDiscoverFr: string | null;
  supportWhatsappUrl: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  tiktokUrl: string | null;
  youtubeUrl: string | null;
  content: Record<string, string>;
}

const EMPTY_SETTINGS: SettingsData = {
  whatsappUrlEn: '',
  whatsappUrlFr: '',
  whatsappUrlDiscoverEn: '',
  whatsappUrlDiscoverFr: '',
  supportWhatsappUrl: '',
  facebookUrl: '',
  instagramUrl: '',
  tiktokUrl: '',
  youtubeUrl: '',
  content: {},
};

function SettingsTab() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<SettingsData>(EMPTY_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<SettingsData>('/api/admin/settings').then(setSettings);
  }, []);

  function field(key: keyof Omit<SettingsData, 'content'>) {
    return settings[key] ?? '';
  }

  function setField(key: keyof Omit<SettingsData, 'content'>, value: string) {
    setSettings((s) => ({ ...s, [key]: value }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      const res = await api.patch<SettingsData>('/api/admin/settings', {
        whatsappUrlEn: settings.whatsappUrlEn,
        whatsappUrlFr: settings.whatsappUrlFr,
        whatsappUrlDiscoverEn: settings.whatsappUrlDiscoverEn,
        whatsappUrlDiscoverFr: settings.whatsappUrlDiscoverFr,
        supportWhatsappUrl: settings.supportWhatsappUrl || undefined,
        facebookUrl: settings.facebookUrl || undefined,
        instagramUrl: settings.instagramUrl || undefined,
        tiktokUrl: settings.tiktokUrl || undefined,
        youtubeUrl: settings.youtubeUrl || undefined,
      });
      setSettings(res);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('admin.settings.save_failed'));
    }
  }

  return (
    <form onSubmit={save} className="max-w-lg space-y-6">
      <div className="card space-y-4">
        <h2 className="font-semibold text-brand-900">{t('admin.settings.training_heading')}</h2>
        <div>
          <label className="label">{t('admin.settings.english_url')}</label>
          <input className="input" value={field('whatsappUrlEn') ?? ''} onChange={(e) => setField('whatsappUrlEn', e.target.value)} required />
        </div>
        <div>
          <label className="label">{t('admin.settings.french_url')}</label>
          <input className="input" value={field('whatsappUrlFr') ?? ''} onChange={(e) => setField('whatsappUrlFr', e.target.value)} required />
        </div>
      </div>

      <div className="card space-y-4">
        <h2 className="font-semibold text-brand-900">{t('admin.settings.discover_heading')}</h2>
        <div>
          <label className="label">{t('admin.settings.english_url')}</label>
          <input
            className="input"
            value={field('whatsappUrlDiscoverEn') ?? ''}
            onChange={(e) => setField('whatsappUrlDiscoverEn', e.target.value)}
          />
        </div>
        <div>
          <label className="label">{t('admin.settings.french_url')}</label>
          <input
            className="input"
            value={field('whatsappUrlDiscoverFr') ?? ''}
            onChange={(e) => setField('whatsappUrlDiscoverFr', e.target.value)}
          />
        </div>
      </div>

      <div className="card space-y-4">
        <h2 className="font-semibold text-brand-900">{t('admin.settings.support_heading')}</h2>
        <div>
          <label className="label">{t('admin.settings.support_whatsapp_url')}</label>
          <input
            className="input"
            value={field('supportWhatsappUrl') ?? ''}
            onChange={(e) => setField('supportWhatsappUrl', e.target.value)}
            placeholder="https://wa.me/2376..."
          />
        </div>
      </div>

      <div className="card space-y-4">
        <h2 className="font-semibold text-brand-900">{t('admin.settings.social_heading')}</h2>
        {(['facebookUrl', 'instagramUrl', 'tiktokUrl', 'youtubeUrl'] as const).map((key) => (
          <div key={key}>
            <label className="label capitalize">{key.replace('Url', '')}</label>
            <input className="input" value={field(key) ?? ''} onChange={(e) => setField(key, e.target.value)} />
          </div>
        ))}
        <p className="text-xs text-slate-400">{t('admin.settings.social_hint')}</p>
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}
      {saved && <p className="text-sm text-green-700">{t('admin.settings.saved')}</p>}
      <button className="btn-primary" type="submit">
        {t('admin.settings.save')}
      </button>
    </form>
  );
}

// Labels come from admin.content.fields.<key> (see i18n files) — this only
// tracks which fields exist and which render as a textarea.
const CONTENT_FIELDS: { key: string; multiline?: boolean }[] = [
  { key: 'homepageTitle' },
  { key: 'homepageSubtitle' },
  { key: 'trainingTitle' },
  { key: 'trainingDescription', multiline: true },
  { key: 'trainingCta' },
  { key: 'discoverTitle' },
  { key: 'discoverDescription', multiline: true },
  { key: 'discoverCta' },
  { key: 'trainingExplanation', multiline: true },
  { key: 'vision', multiline: true },
  { key: 'howItWorks', multiline: true },
  { key: 'footer', multiline: true },
  { key: 'registrationPageText', multiline: true },
  { key: 'successPageText', multiline: true },
  { key: 'contactInfo', multiline: true },
];

// Section 22: deliberately simple — a flat set of named text fields, not a
// full CMS. Blank fields fall back to the app's own built-in default copy.
function ContentTab() {
  const { t } = useTranslation();
  const [content, setContent] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<{ content: Record<string, string> }>('/api/admin/settings').then((res) => setContent(res.content ?? {}));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const res = await api.patch<{ content: Record<string, string> }>('/api/admin/settings', { content });
      setContent(res.content);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('admin.content.save_failed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="max-w-2xl space-y-4">
      <div className="card space-y-4">
        <h2 className="font-semibold text-brand-900">{t('admin.content.title')}</h2>
        <p className="text-xs text-slate-400">{t('admin.content.hint')}</p>
        {CONTENT_FIELDS.map(({ key, multiline }) => (
          <div key={key}>
            <label className="label">{t(`admin.content.fields.${key}`)}</label>
            {multiline ? (
              <textarea
                className="input min-h-[80px]"
                value={content[key] ?? ''}
                onChange={(e) => setContent((c) => ({ ...c, [key]: e.target.value }))}
              />
            ) : (
              <input
                className="input"
                value={content[key] ?? ''}
                onChange={(e) => setContent((c) => ({ ...c, [key]: e.target.value }))}
              />
            )}
          </div>
        ))}
        {error && <p className="text-sm text-red-700">{error}</p>}
        {saved && <p className="text-sm text-green-700">{t('admin.content.saved')}</p>}
        <button className="btn-primary" type="submit" disabled={saving}>
          {saving ? t('admin.content.saving') : t('admin.content.save')}
        </button>
      </div>
    </form>
  );
}

function AuditTab() {
  const { t } = useTranslation();
  const [items, setItems] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    api
      .get<{ items: any[]; pagination: { totalPages: number } }>(`/api/admin/audit?page=${page}&pageSize=20`)
      .then((res) => {
        setItems(res.items);
        setTotalPages(res.pagination.totalPages);
      });
  }, [page]);

  return (
    <div className="card overflow-x-auto">
      <h2 className="mb-3 font-semibold text-brand-900">{t('admin.audit.title')}</h2>
      <table className="w-full min-w-[600px] text-left text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-slate-400">
            <th className="py-2 pr-4">{t('admin.audit.table_action')}</th>
            <th className="py-2 pr-4">{t('admin.audit.table_actor')}</th>
            <th className="py-2 pr-4">{t('admin.audit.table_target')}</th>
            <th className="py-2 pr-4">{t('admin.audit.table_date')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((a) => (
            <tr key={a.id} className="border-b border-slate-50">
              <td className="py-2 pr-4">{a.action}</td>
              <td className="py-2 pr-4">{a.actorEmail ?? '—'}</td>
              <td className="py-2 pr-4">
                {a.targetType}
                {a.targetId ? ` #${a.targetId.slice(0, 8)}` : ''}
              </td>
              <td className="py-2 pr-4">{new Date(a.createdAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <button className="btn-secondary px-3 py-1.5" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {t('admin.prev')}
          </button>
          <span>{t('admin.page_of', { page, total: totalPages })}</span>
          <button
            className="btn-secondary px-3 py-1.5"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            {t('admin.next')}
          </button>
        </div>
      )}
    </div>
  );
}

export function AdminDashboardPage() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const [tab, setTab] = useState<Tab>('overview');
  const [includeTestData, setIncludeTestData] = useState(false);

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-brand-900">{t('admin.dashboard_title')}</h1>
            <p className="text-sm text-slate-500">{user?.name}</p>
          </div>
          <button onClick={() => logout()} className="btn-secondary">
            {t('admin.logout')}
          </button>
        </div>

        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <TabButton active={tab === 'overview'} onClick={() => setTab('overview')}>
              {t('admin.tabs.overview')}
            </TabButton>
            <TabButton active={tab === 'leaders'} onClick={() => setTab('leaders')}>
              {t('admin.tabs.leaders')}
            </TabButton>
            <TabButton active={tab === 'registrations'} onClick={() => setTab('registrations')}>
              {t('admin.tabs.registrations')}
            </TabButton>
            <TabButton active={tab === 'settings'} onClick={() => setTab('settings')}>
              {t('admin.tabs.settings')}
            </TabButton>
            <TabButton active={tab === 'content'} onClick={() => setTab('content')}>
              {t('admin.tabs.content')}
            </TabButton>
            <TabButton active={tab === 'audit'} onClick={() => setTab('audit')}>
              {t('admin.tabs.audit')}
            </TabButton>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={includeTestData}
              onChange={(e) => setIncludeTestData(e.target.checked)}
            />
            {t('admin.include_test_data')}
          </label>
        </div>

        {tab === 'overview' && <OverviewTab includeTestData={includeTestData} />}
        {tab === 'leaders' && <LeadersTab />}
        {tab === 'registrations' && <RegistrationsTab includeTestData={includeTestData} />}
        {tab === 'settings' && <SettingsTab />}
        {tab === 'content' && <ContentTab />}
        {tab === 'audit' && <AuditTab />}
      </section>
    </PageShell>
  );
}
