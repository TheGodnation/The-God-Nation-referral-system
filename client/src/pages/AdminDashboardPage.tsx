import { useEffect, useState } from 'react';
import { PageShell } from '../components/PageShell';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/AuthContext';

type Tab = 'overview' | 'leaders' | 'registrations' | 'settings' | 'audit';

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
  const [created, setCreated] = useState<{ email: string; temporaryPassword: string } | null>(null);

  function load() {
    api.get<{ items: LeaderRow[] }>('/api/admin/leaders?pageSize=100').then((res) => setItems(res.items));
  }

  useEffect(load, []);

  async function createLeader(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await api.post<{ email: string; temporaryPassword: string }>('/api/admin/leaders', {
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
            Leader created. Temporary password for <strong>{created.email}</strong>:{' '}
            <code className="rounded bg-white px-1.5 py-0.5">{created.temporaryPassword}</code>
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

function SettingsTab() {
  const [en, setEn] = useState('');
  const [fr, setFr] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ whatsappUrlEn: string | null; whatsappUrlFr: string | null }>('/api/admin/settings').then((res) => {
      setEn(res.whatsappUrlEn ?? '');
      setFr(res.whatsappUrlFr ?? '');
    });
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      await api.patch('/api/admin/settings', { whatsappUrlEn: en, whatsappUrlFr: fr });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save settings.');
    }
  }

  return (
    <form onSubmit={save} className="card max-w-lg space-y-4">
      <h2 className="font-semibold text-brand-900">WhatsApp Community Settings</h2>
      <div>
        <label className="label">English WhatsApp Community URL</label>
        <input className="input" value={en} onChange={(e) => setEn(e.target.value)} required />
      </div>
      <div>
        <label className="label">French WhatsApp Community URL</label>
        <input className="input" value={fr} onChange={(e) => setFr(e.target.value)} required />
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {saved && <p className="text-sm text-green-700">Settings saved.</p>}
      <button className="btn-primary" type="submit">
        Save Settings
      </button>
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
        {tab === 'audit' && <AuditTab />}
      </section>
    </PageShell>
  );
}
