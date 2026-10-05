import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { NotificationBell } from '../components/NotificationBell';
import { MemberNav } from '../components/member/MemberNav';
import { InstallAppBanner } from '../components/member/InstallAppBanner';
import { CommunityConversation } from '../components/CommunityConversation';
import { PrivateMessages } from '../components/PrivateMessages';
import { Announcements } from '../components/Announcements';
import { api } from '../lib/api';

interface MembershipRow {
  communityId: string;
  communityName: string;
  status: 'ACTIVE' | 'INACTIVE';
}

// "Chats": the member's group chat(s), announcements and private messages.
// (The WhatsApp-style chat screen itself comes in the next step.)
export function MemberChatsPage() {
  const { t } = useTranslation();
  const [memberships, setMemberships] = useState<MembershipRow[] | null>(null);

  useEffect(() => {
    api
      .get<{ items: MembershipRow[] }>('/api/member/me/community-memberships')
      .then((r) => setMemberships(r.items))
      .catch(() => setMemberships([]));
  }, []);

  const active = memberships?.filter((m) => m.status === 'ACTIVE') ?? [];

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-2xl px-4 py-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-brand-900">{t('memberNav.chats')}</h1>
          <NotificationBell />
        </div>
        <InstallAppBanner />
        <div className="space-y-6">
          {memberships === null && <p className="text-center text-slate-400">{t('memberDashboard.loading')}</p>}
          {memberships !== null && active.length === 0 && (
            <p className="card text-sm text-slate-500">{t('memberDashboard.no_memberships')}</p>
          )}
          {active.map((m) => (
            <CommunityConversation key={m.communityId} communityId={m.communityId} communityName={m.communityName} />
          ))}
          <Announcements />
          <PrivateMessages />
        </div>
        <MemberNav />
      </section>
    </PageShell>
  );
}
