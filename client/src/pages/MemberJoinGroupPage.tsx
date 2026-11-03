import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { CommunityChoices } from '../components/CommunityChoices';
import { EnableNotificationsBanner } from '../components/member/EnableNotificationsBanner';
import { communityPlaces, followPlaces } from '../components/socialPlatforms';
import { usePublicSettings } from '../lib/usePublicSettings';
import { api } from '../lib/api';

// The step right after the details form: invite the new member to join the
// ministry's community where they prefer (WhatsApp, Telegram, Messenger,
// Facebook), and follow its pages. Nobody can be added automatically, so each
// is one tap on an invite link. Skipping is fine, and if nothing is set up the
// member goes straight into the app.
export function MemberJoinGroupPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const settings = usePublicSettings();
  const [tapped, setTapped] = useState(false);
  const lang = i18n.language?.startsWith('fr') ? 'fr' : 'en';
  const any = communityPlaces(settings, lang).length + followPlaces(settings).length > 0;

  useEffect(() => {
    if (settings.loaded && !any) navigate('/member/chats', { replace: true });
  }, [settings.loaded, any, navigate]);

  if (!any) return <PageShell minimal><div className="px-4 py-24 text-center text-slate-400">{t('common.loading')}</div></PageShell>;

  function onTap(platform: string) {
    setTapped(true);
    void api.post('/api/member/group-link-click', { platform }).catch(() => {});
  }

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-sm px-4 py-12" data-testid="join-group">
        <EnableNotificationsBanner className="mb-5" />
        <h1 className="text-center text-2xl font-bold text-brand-900">{t('joinGroup.title')}</h1>
        <p className="mb-5 mt-2 text-center text-sm text-slate-600">{t('joinGroup.body')}</p>
        <CommunityChoices settings={settings} onTap={onTap} />
        {tapped && <p role="status" className="mt-3 text-center text-xs text-slate-500">{t('joinGroup.joined_note')}</p>}
        <div className="mt-6 text-center">
          <button type="button" onClick={() => navigate('/member/chats', { replace: true })} className="text-sm font-semibold text-brand-700 underline" data-testid="join-group-continue">
            {tapped ? t('joinGroup.continue') : t('joinGroup.skip')}
          </button>
        </div>
      </section>
    </PageShell>
  );
}
