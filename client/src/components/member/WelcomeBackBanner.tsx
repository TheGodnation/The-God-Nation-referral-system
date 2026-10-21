import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { takeWelcomeBack } from '../../lib/accountDeletion';

// "Welcome back! Your account was not deleted" — once, right after a
// sign-in that cancelled "Delete my account".
export function WelcomeBackBanner() {
  const { t } = useTranslation();
  const [show, setShow] = useState(takeWelcomeBack);
  if (!show) return null;
  return (
    <div role="status" className="fixed inset-x-3 top-3 z-[70] mx-auto flex max-w-md items-start gap-3 rounded-xl bg-green-700 px-4 py-3 text-sm text-white shadow-lg">
      <span className="flex-1">🎉 {t('accountDeletion.welcome_back')}</span>
      <button type="button" aria-label={t('accountDeletion.close') ?? ''} className="font-bold" onClick={() => setShow(false)}>
        ✕
      </button>
    </div>
  );
}
