import { useTranslation } from 'react-i18next';
import { WhatsAppIcon } from '../Icons';
import { usePublicSettings } from '../../lib/usePublicSettings';
import { withPrefilledMessage } from '../../lib/whatsapp';

// A small round WhatsApp button in the bottom-right corner of the Chats page:
// one tap opens a WhatsApp chat with the ministry's assistance number (the
// "Support WhatsApp" the central admin sets in Admin → Settings). It sits just
// above the bottom bar, never over the composer or a list, and nothing shows
// until a number has been set.
export function AssistanceButton() {
  const { t } = useTranslation();
  const { supportWhatsappUrl } = usePublicSettings();
  if (!supportWhatsappUrl) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-20 mx-auto flex max-w-2xl justify-end px-4"
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 4.75rem)' }}
    >
      <a
        href={withPrefilledMessage(supportWhatsappUrl, t('assistance.message'))}
        target="_blank"
        rel="noreferrer"
        aria-label={t('assistance.aria') ?? ''}
        title={t('assistance.label') ?? ''}
        data-testid="assistance-button"
        className="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg ring-2 ring-white/80 transition hover:bg-[#1ebe5b] focus:outline-none focus-visible:ring-4 focus-visible:ring-green-300"
      >
        <WhatsAppIcon className="h-7 w-7" />
      </a>
    </div>
  );
}
