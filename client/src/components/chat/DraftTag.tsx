import { useTranslation } from 'react-i18next';
import { useMemberAuth } from '../../lib/MemberAuthContext';
import { draftKeyFor, loadDraft } from '../../lib/drafts';

/** WhatsApp's red "Draft: …" in the chat list for a chat with unsent text; nothing otherwise. */
export function useChatDraft(place: string): string {
  const { member } = useMemberAuth();
  return loadDraft(draftKeyFor(member?.personId, place)).trim();
}

export function DraftPreview({ draft }: { draft: string }) {
  const { t } = useTranslation();
  return (
    <>
      <span className="font-medium text-red-600">{t('groupChat.draft')}:</span> {draft}
    </>
  );
}
