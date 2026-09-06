import { useEffect, useState } from 'react';
import { PageShell } from '../components/PageShell';
import { api } from '../lib/api';
import { useAuth } from '../lib/AuthContext';

interface DashboardStats {
  totalVisits: number;
  uniqueVisitors: number;
  registrations: number;
  whatsappClicks: number;
  conversionRate: number;
}

interface ReferralItem {
  name: string;
  whatsapp: string;
  language: string;
  registeredAt: string;
  status: string;
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-brand-900">{value}</p>
    </div>
  );
}

export function LeaderDashboardPage() {
  const { user, logout } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [links, setLinks] = useState<{ en: string; fr: string } | null>(null);
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [items, setItems] = useState<ReferralItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ referralCode: string | null; stats: DashboardStats }>('/api/leader/dashboard').then((res) => {
      setStats(res.stats);
      setReferralCode(res.referralCode);
    });
    api
      .get<{ referralCode: string | null; links: { en: string; fr: string } | null }>('/api/leader/links')
      .then((res) => setLinks(res.links));
  }, []);

  useEffect(() => {
    api
      .get<{ items: ReferralItem[]; pagination: { totalPages: number } }>(
        `/api/leader/referrals?page=${page}&pageSize=20`,
      )
      .then((res) => {
        setItems(res.items);
        setTotalPages(res.pagination.totalPages);
      });
  }, [page]);

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // Clipboard API unavailable — no-op; the link is still selectable/visible.
    }
  }

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-brand-900">Leader Dashboard</h1>
            <p className="text-sm text-slate-500">{user?.name}</p>
          </div>
          <button onClick={() => logout()} className="btn-secondary">
            Log out
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label="Referral Code" value={referralCode ?? '—'} />
          <StatCard label="Total Visits" value={stats?.totalVisits ?? '—'} />
          <StatCard label="Registrations" value={stats?.registrations ?? '—'} />
          <StatCard label="WhatsApp Clicks" value={stats?.whatsappClicks ?? '—'} />
          <StatCard label="Conversion" value={stats ? `${stats.conversionRate}%` : '—'} />
        </div>

        <div className="card mt-6">
          <h2 className="mb-3 font-semibold text-brand-900">Your Referral Links</h2>
          {links ? (
            <div className="space-y-3">
              {(['en', 'fr'] as const).map((lang) => (
                <div key={lang} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <span className="w-10 text-sm font-medium uppercase text-slate-500">{lang}</span>
                  <input readOnly value={links[lang]} className="input flex-1 bg-slate-50 text-sm" />
                  <button className="btn-secondary sm:w-32" onClick={() => copy(links[lang], lang)}>
                    {copied === lang ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">No active referral code assigned yet.</p>
          )}
        </div>

        <div className="card mt-6 overflow-x-auto">
          <h2 className="mb-3 font-semibold text-brand-900">Your Referrals</h2>
          <table className="w-full min-w-[500px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-slate-400">
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">WhatsApp</th>
                <th className="py-2 pr-4">Language</th>
                <th className="py-2 pr-4">Registered</th>
                <th className="py-2 pr-4">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r, idx) => (
                <tr key={idx} className="border-b border-slate-50">
                  <td className="py-2 pr-4">{r.name}</td>
                  <td className="py-2 pr-4">{r.whatsapp}</td>
                  <td className="py-2 pr-4 uppercase">{r.language}</td>
                  <td className="py-2 pr-4">{new Date(r.registeredAt).toLocaleDateString()}</td>
                  <td className="py-2 pr-4">{r.status}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-slate-400">
                    No referrals yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-3 text-sm">
              <button
                className="btn-secondary px-3 py-1.5"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
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
      </section>
    </PageShell>
  );
}
