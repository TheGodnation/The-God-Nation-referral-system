import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { WhatsAppIcon } from '../components/Icons';
import { usePublicSettings } from '../lib/usePublicSettings';
import { api } from '../lib/api';

// The step right after the details form: invite the new member to the
// ministry's WhatsApp group in their language. WhatsApp lets nobody be added
// automatically, so this is one tap on the invite link. Skipping is fine, and
// if no group link is set the member goes straight into the app.
export function MemberJoinGroupPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { whatsappGroupEnUrl, whatsappGroupFrUrl, loaded } = usePublicSettings();
  const [opened, setOpened] = useState(false);
  const fr = i18n.language?.startsWith('fr');
  const url = (fr ? whatsappGroupFrUrl || whatsappGroupEnUrl : whatsappGroupEnUrl || whatsappGroupFrUrl) || null;
  const groupIsFrench = Boolean(url) && url === whatsappGroupFrUrl && url !== whatsappGroupEnUrl;

  useEffect(() => {
    if (loaded && !url) navigate('/member/chats', { replace: true });
  }, [loaded, url, navigate]);

  if (!url) return <PageShell minimal><div className="px-4 py-24 text-center text-slate-400">{t('common.loading')}</div></PageShell>;

  function onJoin() {
    setOpened(true);
    void api.post('/api/member/group-link-click', {}).catch(() => {});
  }

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-sm px-4 py-14 text-center" data-testid="join-group">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#25D366] text-white">
          <WhatsAppIcon className="h-9 w-9" />
        </div>
        <h1 className="mt-5 text-2xl font-bold text-brand-900">{t('joinGroup.title')}</h1>
        <p className="mt-2 text-sm text-slate-600">{groupIsFrench ? t('joinGroup.body_fr') : t('joinGroup.body_en')}</p>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          onClick={onJoin}
          data-testid="join-group-button"
          className="btn-primary mt-6 flex w-full items-center justify-center gap-2"
        >
          <WhatsAppIcon className="h-5 w-5" />
          {t('joinGroup.button')}
        </a>
        {opened && <p role="status" className="mt-3 text-xs text-slate-500">{t('joinGroup.joined_note')}</p>}
        <button type="button" onClick={() => navigate('/member/chats', { replace: true })} className="mt-4 text-sm font-semibold text-brand-700 underline" data-testid="join-group-continue">
          {opened ? t('joinGroup.continue') : t('joinGroup.skip')}
        </button>
      </section>
    </PageShell>
  );
}
