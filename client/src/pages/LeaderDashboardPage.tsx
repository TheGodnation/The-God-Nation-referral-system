import { useEffect, useState } from 'react';
import { OpenMemberProfileButton } from '../components/OpenMemberProfileButton';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { PasswordInput } from '../components/PasswordInput';
import { NotificationBell } from '../components/NotificationBell';
import { LeadershipDashboardBody } from '../components/leader/LeadershipDashboardBody';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/AuthContext';
import { useMemberAuth } from '../lib/MemberAuthContext';

// null: not linked to a Member profile yet. false: linked, but no password
// set on that Member profile yet (see the bridge's own comment below).
type MemberProfileHasPassword = boolean | null;

// The Leader <-> Member identity bridge (existing Leaders only — see
// server/src/routes/leader.ts POST /me/create-member-profile). One-time
// and self-serve: once linked AND a password is set, this card is replaced
// by a simple link to the Leader's own Member profile, which they're now
// also signed into. A password is required right here (not just the old
// WhatsApp-number-only form) so the Leader can sign in directly on the
// phone app later — without it, their first sign-out would permanently
// lock them out of the Member sign-in (nothing to check a password
// against). `memberProfileHasPassword === false` means a Leader who linked
// before this existed — same lockout, fixed via its own small form instead
// of redoing the whole link.
function MemberProfileBridge({
  memberProfileHasPassword,
  onLinked,
}: {
  memberProfileHasPassword: MemberProfileHasPassword;
  onLinked: () => void;
}) {
  const { t } = useTranslation();
  const [showForm, setShowForm] = useState(false);
  const [whatsapp, setWhatsapp] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (memberProfileHasPassword === false) {
    return (
      <div className="card mt-6 space-y-2">
        <h2 className="font-semibold text-brand-900">{t('leader.member_bridge_needs_password_title')}</h2>
        <p className="text-sm text-slate-500">{t('leader.member_bridge_needs_password_help')}</p>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            if (password.length < 8) {
              setError(t('leader.member_bridge_password_hint'));
              return;
            }
            setBusy(true);
            try {
              await api.post('/api/leader/me/set-member-password', { password });
              onLinked();
            } catch (err) {
              setError(err instanceof ApiError ? err.message : t('leader.member_bridge_failed'));
            } finally {
              setBusy(false);
            }
          }}
        >
          <div>
            <label className="label" htmlFor="leader-set-member-password">{t('leader.member_bridge_password_label')}</label>
            <PasswordInput id="leader-set-member-password" value={password} onChange={setPassword} autoComplete="new-password" minLength={8} />
          </div>
          <button type="submit" className="btn-primary" disabled={busy}>
            {t('leader.member_bridge_set_password_submit')}
          </button>
        </form>
        {error && <p className="text-sm text-red-700">{error}</p>}
      </div>
    );
  }

  if (memberProfileHasPassword === true) {
    return (
      <div className="card mt-6 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">{t('leader.member_bridge_linked')}</p>
        <OpenMemberProfileButton endpoint="/api/leader/me/open-member-profile" className="btn-secondary">
          {t('leader.view_member_profile')}
        </OpenMemberProfileButton>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError(t('leader.member_bridge_password_hint'));
      return;
    }
    setBusy(true);
    try {
      await api.post('/api/leader/me/create-member-profile', { whatsapp, password });
      onLinked();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('leader.member_bridge_failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card mt-6 space-y-2">
      <h2 className="font-semibold text-brand-900">{t('leader.member_bridge_title')}</h2>
      <p className="text-sm text-slate-500">{t('leader.member_bridge_help')}</p>
      {!showForm ? (
        <button type="button" className="btn-primary" onClick={() => setShowForm(true)}>
          {t('leader.member_bridge_cta')}
        </button>
      ) : (
        <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
          <div>
            <label className="label" htmlFor="leader-member-bridge-whatsapp">{t('leader.member_bridge_whatsapp_label')}</label>
            <input
              id="leader-member-bridge-whatsapp"
              className="input"
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              placeholder="+237 6XX XXX XXX"
            />
          </div>
          <div>
            <label className="label" htmlFor="leader-member-bridge-password">{t('leader.member_bridge_password_label')}</label>
            <PasswordInput id="leader-member-bridge-password" value={password} onChange={setPassword} autoComplete="new-password" minLength={8} />
          </div>
          <button type="submit" className="btn-primary" disabled={busy}>
            {t('leader.member_bridge_submit')}
          </button>
        </form>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}

export function LeaderDashboardPage() {
  const { t } = useTranslation();
  const { user, logout, refresh } = useAuth();
  const { refresh: refreshMember } = useMemberAuth();
  const [memberProfileHasPassword, setMemberProfileHasPassword] = useState<MemberProfileHasPassword>(null);

  function loadDashboard() {
    api
      .get<{ memberProfileHasPassword: MemberProfileHasPassword }>('/api/leader/dashboard')
      .then((res) => setMemberProfileHasPassword(res.memberProfileHasPassword));
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-brand-900">{t('leader.dashboard_title')}</h1>
            <p className="text-sm text-slate-500">{user?.name}</p>
          </div>
          <div className="flex items-center gap-2">
            <NotificationBell />
            <button onClick={() => logout()} className="btn-secondary">
              {t('leader.logout')}
            </button>
          </div>
        </div>

        <MemberProfileBridge
          memberProfileHasPassword={memberProfileHasPassword}
          onLinked={() => {
            refresh();
            refreshMember();
            loadDashboard();
          }}
        />

        <LeadershipDashboardBody />
      </section>
    </PageShell>
  );
}
