import { useEffect, useState } from 'react';
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
  const [data, setData] = useState<Overview | null>(null);

  useEffect(() => {
    api.get<Overview>(`/api/admin/dashboard?includeTestData=${includeTestData}`).then(setData);
  }, [includeTestData]);

  if (!data) return <p className="text-slate-400">Loading…</p>;

  return (
    <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
      {[
        ['Total Visits', data.totalVisits],
        ['Unique Visitors', data.uniqueVisitors],
        ['Registrations', data.registrations],
        ['WhatsApp Clicks', data.whatsappClicks],
        ['Active Leaders', data.activeLeaders],
        ['Conversion', `${data.conversionRate}%`],
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
      setError(err instanceof ApiError ? err.message : 'Failed to create leader.');
    }
  }

  async function toggleActive(leader: LeaderRow) {
    await api.patch(`/api/admin/leaders/${leader.id}`, { active: !leader.active });
    load();
  }

  // Section 32: recovery when a Leader never received/lost/let expire
  // their invitation. Never sets or reveals a password directly.
  async function resendInvitation(leader: LeaderRow) {
    setResendStatus((s) => ({ ...s, [leader.id]: 'Sending…' }));
    try {
      const res = await api.post<{ invitationSent: boolean }>(`/api/admin/leaders/${leader.id}/resend-invitation`);
      setResendStatus((s) => ({ ...s, [leader.id]: res.invitationSent ? 'Invitation sent!' : 'Send failed.' }));
    } catch {
      setResendStatus((s) => ({ ...s, [leader.id]: 'Send failed.' }));
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold text-brand-900">Leaders</h2>
        <button className="btn-primary px-4 py-2" onClick={() => setShowForm((v) => !v)}>
          + New Leader
        </button>
      </div>

      {created && (
        <div className="card mb-4 border-green-200 bg-green-50">
          <p className="text-sm text-green-800">
            Leader created. {created.invitationSent
              ? <>An invitation email was sent to <strong>{created.email}</strong> with a secure setup link.</>
              : <>Could not send the invitation email to <strong>{created.email}</strong> — use "Resend Invitation" below once email is configured.</>}
          </p>
        </div>
      )}

      {showForm && (
        <form onSubmit={createLeader} className="card mb-4 space-y-3">
          <input className="input" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} required />
          <input
            className="input"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="input"
            placeholder="Referral code (e.g. MARY7X2)"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
          {error && <p className="text-sm text-red-700">{error}</p>}
          <button className="btn-primary" type="submit">
            Create Leader
          </button>
        </form>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[600px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-slate-400">
              <th className="py-2 pr-4">Name</th>
              <th className="py-2 pr-4">Email</th>
              <th className="py-2 pr-4">Code</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Test</th>
              <th className="py-2 pr-4"></th>
              <th className="py-2 pr-4"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((l) => (
              <tr key={l.id} className="border-b border-slate-50">
                <td className="py-2 pr-4">{l.name}</td>
                <td className="py-2 pr-4">{l.email}</td>
                <td className="py-2 pr-4">{l.referralCode ?? '—'}</td>
                <td className="py-2 pr-4">{l.active ? 'Active' : 'Inactive'}</td>
                <td className="py-2 pr-4">{l.isTestData ? 'Yes' : 'No'}</td>
                <td className="py-2 pr-4">
                  <button className="text-brand-700 hover:underline" onClick={() => toggleActive(l)}>
                    {l.active ? 'Deactivate' : 'Activate'}
                  </button>
                </td>
                <td className="py-2 pr-4">
                  <button className="text-brand-700 hover:underline" onClick={() => resendInvitation(l)}>
                    {resendStatus[l.id] ?? 'Resend Invitation'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RegistrationsTab({ includeTestData }: { includeTestData: boolean }) {
  const [items, setItems] = useState<RegistrationRow[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    api
      .get<{ items: RegistrationRow[]; pagination: { totalPages: number } }>(
        `/api/admin/registrations?page=${page}&pageSize=20&includeTestData=${includeTestData}`,
      )
      .then((res) => {
        setItems(res.items);
        setTotalPages(res.pagination.totalPages);
      });
  }, [page, includeTestData]);

  return (
    <div className="card overflow-x-auto">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold text-brand-900">Registrations</h2>
        <a className="text-sm text-brand-700 hover:underline" href="/api/admin/export">
          Export CSV
        </a>
      </div>
      <table className="w-full min-w-[700px] text-left text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-slate-400">
            <th className="py-2 pr-4">Name</th>
            <th className="py-2 pr-4">WhatsApp</th>
            <th className="py-2 pr-4">Language</th>
            <th className="py-2 pr-4">Leader</th>
            <th className="py-2 pr-4">Date</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.id} className="border-b border-slate-50">
              <td className="py-2 pr-4">{r.name}</td>
              <td className="py-2 pr-4">{r.whatsapp}</td>
              <td className="py-2 pr-4 uppercase">{r.language}</td>
              <td className="py-2 pr-4">{r.leader?.name ?? '—'}</td>
              <td className="py-2 pr-4">{new Date(r.createdAt).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <button className="btn-secondary px-3 py-1.5" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Prev
          </button>
          <span>
            Page {page} / {totalPages}
          </span>
          <button
            className="btn-secondary px-3 py-1.5"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
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
      setError(err instanceof ApiError ? err.message : 'Failed to save settings.');
    }
  }

  return (
    <form onSubmit={save} className="max-w-lg space-y-6">
      <div className="card space-y-4">
        <h2 className="font-semibold text-brand-900">Training WhatsApp Community</h2>
        <div>
          <label className="label">English URL</label>
          <input className="input" value={field('whatsappUrlEn') ?? ''} onChange={(e) => setField('whatsappUrlEn', e.target.value)} required />
        </div>
        <div>
          <label className="label">French URL</label>
          <input className="input" value={field('whatsappUrlFr') ?? ''} onChange={(e) => setField('whatsappUrlFr', e.target.value)} required />
        </div>
      </div>

      <div className="card space-y-4">
        <h2 className="font-semibold text-brand-900">Discover &amp; Grow WhatsApp Community</h2>
        <div>
          <label className="label">English URL</label>
          <input
            className="input"
            value={field('whatsappUrlDiscoverEn') ?? ''}
            onChange={(e) => setField('whatsappUrlDiscoverEn', e.target.value)}
          />
        </div>
        <div>
          <label className="label">French URL</label>
          <input
            className="input"
            value={field('whatsappUrlDiscoverFr') ?? ''}
            onChange={(e) => setField('whatsappUrlDiscoverFr', e.target.value)}
          />
        </div>
      </div>

      <div className="card space-y-4">
        <h2 className="font-semibold text-brand-900">Support</h2>
        <div>
          <label className="label">Support WhatsApp URL</label>
          <input
            className="input"
            value={field('supportWhatsappUrl') ?? ''}
            onChange={(e) => setField('supportWhatsappUrl', e.target.value)}
            placeholder="https://wa.me/2376..."
          />
        </div>
      </div>

      <div className="card space-y-4">
        <h2 className="font-semibold text-brand-900">Social Media</h2>
        {(['facebookUrl', 'instagramUrl', 'tiktokUrl', 'youtubeUrl'] as const).map((key) => (
          <div key={key}>
            <label className="label capitalize">{key.replace('Url', '')}</label>
            <input className="input" value={field(key) ?? ''} onChange={(e) => setField(key, e.target.value)} />
          </div>
        ))}
        <p className="text-xs text-slate-400">Leave a field blank to hide that social link on the homepage.</p>
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}
      {saved && <p className="text-sm text-green-700">Settings saved.</p>}
      <button className="btn-primary" type="submit">
        Save Settings
      </button>
    </form>
  );
}

const CONTENT_FIELDS: { key: string; label: string; multiline?: boolean }[] = [
  { key: 'homepageTitle', label: 'Homepage Main Title' },
  { key: 'homepageSubtitle', label: 'Homepage Subtitle' },
  { key: 'trainingTitle', label: 'Training Title' },
  { key: 'trainingDescription', label: 'Training Description', multiline: true },
  { key: 'trainingCta', label: 'Training CTA Button Text' },
  { key: 'discoverTitle', label: 'Discover & Grow Title' },
  { key: 'discoverDescription', label: 'Discover & Grow Description', multiline: true },
  { key: 'discoverCta', label: 'Discover & Grow CTA Button Text' },
  { key: 'trainingExplanation', label: 'Training Explanation', multiline: true },
  { key: 'vision', label: 'Vision Statement', multiline: true },
  { key: 'howItWorks', label: 'How It Works', multiline: true },
  { key: 'footer', label: 'Footer Text', multiline: true },
  { key: 'registrationPageText', label: 'Registration Page Text', multiline: true },
  { key: 'successPageText', label: 'Success Page Text', multiline: true },
  { key: 'contactInfo', label: 'Contact / Help Information', multiline: true },
];

// Section 22: deliberately simple — a flat set of named text fields, not a
// full CMS. Blank fields fall back to the app's own built-in default copy.
function ContentTab() {
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
      setError(err instanceof ApiError ? err.message : 'Failed to save content.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="max-w-2xl space-y-4">
      <div className="card space-y-4">
        <h2 className="font-semibold text-brand-900">Website Content</h2>
        <p className="text-xs text-slate-400">Leave any field blank to use the default built-in text.</p>
        {CONTENT_FIELDS.map(({ key, label, multiline }) => (
          <div key={key}>
            <label className="label">{label}</label>
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
        {saved && <p className="text-sm text-green-700">Content saved.</p>}
        <button className="btn-primary" type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save Content'}
        </button>
      </div>
    </form>
  );
}

function AuditTab() {
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
      <h2 className="mb-3 font-semibold text-brand-900">Audit Log</h2>
      <table className="w-full min-w-[600px] text-left text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-slate-400">
            <th className="py-2 pr-4">Action</th>
            <th className="py-2 pr-4">Actor</th>
            <th className="py-2 pr-4">Target</th>
            <th className="py-2 pr-4">Date</th>
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
            Prev
          </button>
          <span>
            Page {page} / {totalPages}
          </span>
          <button
            className="btn-secondary px-3 py-1.5"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

export function AdminDashboardPage() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState<Tab>('overview');
  const [includeTestData, setIncludeTestData] = useState(false);

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-brand-900">Admin Dashboard</h1>
            <p className="text-sm text-slate-500">{user?.name}</p>
          </div>
          <button onClick={() => logout()} className="btn-secondary">
            Log out
          </button>
        </div>

        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <TabButton active={tab === 'overview'} onClick={() => setTab('overview')}>
              Overview
            </TabButton>
            <TabButton active={tab === 'leaders'} onClick={() => setTab('leaders')}>
              Leaders
            </TabButton>
            <TabButton active={tab === 'registrations'} onClick={() => setTab('registrations')}>
              Registrations
            </TabButton>
            <TabButton active={tab === 'settings'} onClick={() => setTab('settings')}>
              Settings
            </TabButton>
            <TabButton active={tab === 'content'} onClick={() => setTab('content')}>
              Website Content
            </TabButton>
            <TabButton active={tab === 'audit'} onClick={() => setTab('audit')}>
              Audit Log
            </TabButton>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={includeTestData}
              onChange={(e) => setIncludeTestData(e.target.checked)}
            />
            Include test data (QA)
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
