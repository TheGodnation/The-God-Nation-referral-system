import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { PasswordInput } from '../components/PasswordInput';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/AuthContext';

type Tab = 'overview' | 'leaders' | 'registrations' | 'settings' | 'content' | 'account' | 'audit';

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
  selfRegistered: boolean;
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

  // Editing an existing Leader's name/email/referral code (section: Admin
  // recovery when one of these was entered wrong at creation time — email
  // in particular could never be corrected before this).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editCode, setEditCode] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

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

  function startEdit(leader: LeaderRow) {
    setShowForm(false);
    setEditingId(leader.id);
    setEditName(leader.name);
    setEditEmail(leader.email);
    setEditCode(leader.referralCode ?? '');
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditError(null);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    setEditError(null);
    try {
      await api.patch(`/api/admin/leaders/${editingId}`, {
        name: editName,
        email: editEmail,
        referralCode: editCode,
      });
      setEditingId(null);
      load();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : t('admin.leaders.save_failed'));
    }
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

      {editingId && (
        <form onSubmit={saveEdit} className="card mb-4 space-y-3">
          <h3 className="font-semibold text-brand-900">{t('admin.leaders.edit_leader')}</h3>
          <input
            className="input"
            placeholder={t('admin.leaders.name_placeholder') ?? ''}
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            required
          />
          <input
            className="input"
            type="email"
            placeholder={t('admin.leaders.email_placeholder') ?? ''}
            value={editEmail}
            onChange={(e) => setEditEmail(e.target.value)}
            required
          />
          <input
            className="input"
            placeholder={t('admin.leaders.code_placeholder') ?? ''}
            value={editCode}
            onChange={(e) => setEditCode(e.target.value)}
            required
          />
          {editError && <p className="text-sm text-red-700">{editError}</p>}
          <div className="flex gap-3">
            <button className="btn-primary" type="submit">
              {t('admin.leaders.save_changes')}
            </button>
            <button type="button" className="text-sm text-slate-500 hover:underline" onClick={cancelEdit}>
              {t('admin.leaders.cancel')}
            </button>
          </div>
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
              <th className="py-2 pr-4">{t('admin.leaders.table_source')}</th>
              <th className="py-2 pr-4">{t('admin.leaders.table_test')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((l) => (
              <tr key={l.id} className="border-b border-slate-50">
                <td className="sticky left-0 z-10 flex flex-col items-start gap-1 bg-white py-2 pr-4 shadow-[8px_0_8px_-8px_rgba(0,0,0,0.1)]">
                  <button className="text-brand-700 hover:underline" onClick={() => startEdit(l)}>
                    {t('admin.leaders.edit')}
                  </button>
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
                <td className="py-2 pr-4">
                  {l.selfRegistered ? (
                    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
                      {t('admin.leaders.source_self')}
                    </span>
                  ) : (
                    <span className="text-slate-400">{t('admin.leaders.source_admin')}</span>
                  )}
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

// Admin-triggered only — never automatic. Always shows the recipient count
// first and requires an explicit confirmation before anything is sent.
function WhatsAppReminders({ includeTestData }: { includeTestData: boolean }) {
  const { t } = useTranslation();
  const [count, setCount] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ attempted: number; sent: number; failed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function loadCount() {
    api
      .get<{ count: number }>(`/api/admin/whatsapp-reminders/count?includeTestData=${includeTestData}`)
      .then((res) => setCount(res.count))
      .catch(() => setCount(null));
  }

  useEffect(loadCount, [includeTestData]);

  async function sendReminders() {
    if (count === null) return;
    if (!window.confirm(t('admin.registrations.reminders_confirm', { count }))) {
      return;
    }
    setError(null);
    setResult(null);
    setSending(true);
    try {
      const res = await api.post<{ attempted: number; sent: number; failed: number }>(
        `/api/admin/whatsapp-reminders/send?includeTestData=${includeTestData}`,
      );
      setResult(res);
      loadCount();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('admin.registrations.reminders_failed'));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="card mb-4 space-y-2">
      <h2 className="font-semibold text-brand-900">{t('admin.registrations.reminders_title')}</h2>
      <p className="text-sm text-slate-600">
        {count === null ? t('admin.loading') : t('admin.registrations.reminders_count', { count })}
      </p>
      <button className="btn-primary" onClick={sendReminders} disabled={sending || !count}>
        {sending ? t('admin.registrations.reminders_sending') : t('admin.registrations.reminders_send')}
      </button>
      {result && (
        <p className="text-sm text-green-700">
          {t('admin.registrations.reminders_result', { sent: result.sent, attempted: result.attempted })}
        </p>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
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
    <div>
      <WhatsAppReminders includeTestData={includeTestData} />
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
  whatsappContactUrl: string | null;
  telegramUrl: string | null;
  messengerUrl: string | null;
  leaderSignupPhrase: string | null;
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
  whatsappContactUrl: '',
  telegramUrl: '',
  messengerUrl: '',
  leaderSignupPhrase: '',
  content: {},
};

function SettingsTab() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<SettingsData>(EMPTY_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const signupLink = `${window.location.origin}/leader-signup`;

  async function copySignupLink() {
    try {
      await navigator.clipboard.writeText(signupLink);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1500);
    } catch {
      // Clipboard API unavailable — no-op; the link is still selectable/visible.
    }
  }

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
        whatsappContactUrl: settings.whatsappContactUrl || undefined,
        telegramUrl: settings.telegramUrl || undefined,
        messengerUrl: settings.messengerUrl || undefined,
        // Unlike the URL fields above, an intentionally blank phrase is a
        // real, submittable value here — it's how self-signup gets turned
        // off — so it's always sent, never swapped for `undefined`.
        leaderSignupPhrase: settings.leaderSignupPhrase ?? '',
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
        <h2 className="font-semibold text-brand-900">{t('admin.settings.leader_signup_heading')}</h2>
        <div>
          <label className="label">{t('admin.settings.leader_signup_phrase')}</label>
          <input
            className="input"
            value={field('leaderSignupPhrase') ?? ''}
            onChange={(e) => setField('leaderSignupPhrase', e.target.value)}
            placeholder={t('admin.settings.leader_signup_phrase_placeholder') ?? ''}
          />
          <p className="mt-1 text-xs text-slate-400">{t('admin.settings.leader_signup_hint')}</p>
        </div>
        <div>
          <label className="label">{t('admin.settings.leader_signup_link')}</label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input readOnly value={signupLink} className="input flex-1 bg-slate-50 text-sm" />
            <button type="button" className="btn-secondary sm:w-32" onClick={copySignupLink}>
              {linkCopied ? t('leader.copied') : t('leader.copy')}
            </button>
          </div>
        </div>
      </div>

      <div className="card space-y-4">
        <h2 className="font-semibold text-brand-900">{t('admin.settings.social_heading')}</h2>
        {(
          [
            ['whatsappContactUrl', 'WhatsApp'],
            ['telegramUrl', 'Telegram'],
            ['messengerUrl', 'Messenger'],
            ['facebookUrl', 'Facebook'],
            ['instagramUrl', 'Instagram'],
            ['tiktokUrl', 'TikTok'],
            ['youtubeUrl', 'YouTube'],
          ] as const
        ).map(([key, label]) => (
          <div key={key}>
            <label className="label">{label}</label>
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
// Every field here is stored as a bilingual pair — key+"En" and key+"Fr" —
// so an Admin edit in one language never silently overrides what the other
// language's visitors see (see server/src/routes/admin.ts CONTENT_BASE_KEYS,
// which this list must stay in sync with). Grouped by section purely for
// readability; the section key itself isn't sent anywhere.
// bilingual defaults to true; set false for a field with a single value
// (no En/Fr suffix) — used for emails that only ever go to Leaders/Admins,
// who have no stored language preference.
const CONTENT_SECTIONS: {
  section: string;
  fields: { key: string; multiline?: boolean; bilingual?: boolean }[];
}[] = [
  {
    section: 'hero',
    fields: [
      { key: 'homepageTitle' },
      { key: 'homepageSubtitle' },
      { key: 'heroSupport', multiline: true },
      { key: 'heroCta' },
    ],
  },
  {
    section: 'training',
    fields: [
      { key: 'trainingTitle' },
      { key: 'trainingSupporting' },
      { key: 'trainingDescription', multiline: true },
      { key: 'trainingExplanation', multiline: true },
      { key: 'trainingCta' },
    ],
  },
  {
    section: 'discover',
    fields: [
      { key: 'discoverTitle' },
      { key: 'discoverSupporting' },
      { key: 'discoverDescription', multiline: true },
      { key: 'discoverCta' },
    ],
  },
  {
    section: 'vision',
    fields: [{ key: 'visionTitle' }, { key: 'vision', multiline: true }],
  },
  {
    section: 'howItWorks',
    fields: [
      { key: 'howTitle' },
      { key: 'how1Title' },
      { key: 'how1Body', multiline: true },
      { key: 'how2Title' },
      { key: 'how2Body', multiline: true },
      { key: 'how3Title' },
      { key: 'how3Body', multiline: true },
    ],
  },
  {
    section: 'footer',
    fields: [{ key: 'connectTitle' }, { key: 'footer' }, { key: 'contactInfo', multiline: true }],
  },
  {
    section: 'registration',
    fields: [{ key: 'registrationPageText', multiline: true }],
  },
  {
    section: 'success',
    fields: [{ key: 'successPageText', multiline: true }],
  },
  {
    section: 'emails',
    fields: [
      { key: 'emailRegistrationConfirmationSubject' },
      { key: 'emailRegistrationConfirmationBody', multiline: true },
      { key: 'emailWhatsappReminderSubject' },
      { key: 'emailWhatsappReminderBody', multiline: true },
      { key: 'emailLeaderInvitationSubject', bilingual: false },
      { key: 'emailLeaderInvitationBody', multiline: true, bilingual: false },
      { key: 'emailPasswordResetSubject', bilingual: false },
      { key: 'emailPasswordResetBody', multiline: true, bilingual: false },
    ],
  },
];

// Section 22: deliberately simple — a flat set of named bilingual text
// fields, not a full CMS. Blank fields fall back to the app's own built-in
// (fully translated) default copy for that language.
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

  function field(storageKey: string, multiline: boolean | undefined) {
    const value = content[storageKey] ?? '';
    const onChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setContent((c) => ({ ...c, [storageKey]: e.target.value }));
    return multiline ? (
      <textarea className="input min-h-[70px]" value={value} onChange={onChange} />
    ) : (
      <input className="input" value={value} onChange={onChange} />
    );
  }

  return (
    <form onSubmit={save} className="max-w-3xl space-y-4">
      <div className="card space-y-2">
        <h2 className="font-semibold text-brand-900">{t('admin.content.title')}</h2>
        <p className="text-xs text-slate-400">{t('admin.content.hint')}</p>
      </div>
      {CONTENT_SECTIONS.map(({ section, fields }) => (
        <div key={section} className="card space-y-4">
          <h3 className="font-semibold text-brand-900">{t(`admin.content.sections.${section}`)}</h3>
          {section === 'emails' && <p className="text-xs text-slate-400">{t('admin.content.emails_hint')}</p>}
          {fields.map(({ key, multiline, bilingual = true }) => (
            <div key={key}>
              <label className="label">{t(`admin.content.fields.${key}`)}</label>
              {bilingual ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <span className="mb-1 block text-xs text-slate-400">{t('common.language_en')}</span>
                    {field(`${key}En`, multiline)}
                  </div>
                  <div>
                    <span className="mb-1 block text-xs text-slate-400">{t('common.language_fr')}</span>
                    {field(`${key}Fr`, multiline)}
                  </div>
                </div>
              ) : (
                field(key, multiline)
              )}
            </div>
          ))}
        </div>
      ))}
      <div className="card space-y-3">
        {error && <p className="text-sm text-red-700">{error}</p>}
        {saved && <p className="text-sm text-green-700">{t('admin.content.saved')}</p>}
        <button className="btn-primary" type="submit" disabled={saving}>
          {saving ? t('admin.content.saving') : t('admin.content.save')}
        </button>
      </div>
    </form>
  );
}

// Section: self-service account settings. Distinct from managing other
// Leaders' accounts — this is the logged-in user changing their OWN email
// or password, most importantly so the email on file is one they can
// actually receive a "forgot password" link at.
function AccountTab() {
  const { t } = useTranslation();
  const { user, refresh } = useAuth();

  const [emailPassword, setEmailPassword] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSaved, setEmailSaved] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  async function saveEmail(e: React.FormEvent) {
    e.preventDefault();
    setEmailError(null);
    setEmailSaved(false);
    setSavingEmail(true);
    try {
      await api.post('/api/auth/update-email', { currentPassword: emailPassword, newEmail });
      await refresh();
      setEmailPassword('');
      setNewEmail('');
      setEmailSaved(true);
    } catch (err) {
      setEmailError(err instanceof ApiError ? err.message : t('admin.account.email_failed'));
    } finally {
      setSavingEmail(false);
    }
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSaved(false);
    setSavingPassword(true);
    try {
      await api.post('/api/auth/change-password', { currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setPasswordSaved(true);
    } catch (err) {
      setPasswordError(err instanceof ApiError ? err.message : t('admin.account.password_failed'));
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <div className="max-w-lg space-y-6">
      <div className="card space-y-4">
        <h2 className="font-semibold text-brand-900">{t('admin.account.email_heading')}</h2>
        <p className="text-sm text-slate-500">
          {t('admin.account.email_hint', { email: user?.email ?? '' })}
        </p>
        <form onSubmit={saveEmail} className="space-y-3">
          <div>
            <label className="label">{t('admin.account.new_email')}</label>
            <input
              type="email"
              className="input"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label">{t('admin.account.current_password')}</label>
            <PasswordInput id="account-email-current-password" value={emailPassword} onChange={setEmailPassword} required />
          </div>
          {emailError && <p className="text-sm text-red-700">{emailError}</p>}
          {emailSaved && <p className="text-sm text-green-700">{t('admin.account.email_saved')}</p>}
          <button className="btn-primary" type="submit" disabled={savingEmail}>
            {savingEmail ? t('admin.account.saving') : t('admin.account.save_email')}
          </button>
        </form>
      </div>

      <div className="card space-y-4">
        <h2 className="font-semibold text-brand-900">{t('admin.account.password_heading')}</h2>
        <form onSubmit={savePassword} className="space-y-3">
          <div>
            <label className="label">{t('admin.account.current_password')}</label>
            <PasswordInput id="account-current-password" value={currentPassword} onChange={setCurrentPassword} required />
          </div>
          <div>
            <label className="label">{t('admin.account.new_password')}</label>
            <PasswordInput id="account-new-password" value={newPassword} onChange={setNewPassword} required minLength={8} />
          </div>
          {passwordError && <p className="text-sm text-red-700">{passwordError}</p>}
          {passwordSaved && <p className="text-sm text-green-700">{t('admin.account.password_saved')}</p>}
          <button className="btn-primary" type="submit" disabled={savingPassword}>
            {savingPassword ? t('admin.account.saving') : t('admin.account.save_password')}
          </button>
        </form>
      </div>
    </div>
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
            <TabButton active={tab === 'account'} onClick={() => setTab('account')}>
              {t('admin.tabs.account')}
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
        {tab === 'account' && <AccountTab />}
        {tab === 'audit' && <AuditTab />}
      </section>
    </PageShell>
  );
}
