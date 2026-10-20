import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { suggestEmailFix } from '../lib/emailTypo';

// "Did you mean …@gmail.com?" under an email box. It shows when the visitor
// leaves the box, and once more if they press the button straight away — so
// a code is never sent to a misspelled address like …@gmil.com without the
// visitor seeing it first. Choosing "No, keep mine" stops asking for that
// exact address.
export function useEmailTypoCheck(email: string, setEmail: (value: string) => void) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  const [kept, setKept] = useState<string | null>(null);
  const suggestion = useMemo(() => {
    const fix = suggestEmailFix(email);
    return fix && email.trim() !== kept ? fix : null;
  }, [email, kept]);

  function onBlur() {
    if (suggestion) setShown(true);
  }

  // Call at the start of submit: false means "stop, the hint is now showing".
  function confirmBeforeSubmit() {
    if (!suggestion) return true;
    setShown(true);
    return false;
  }

  const hint =
    shown && suggestion ? (
      <div role="status" className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
        <p>{t('emailTypo.did_you_mean', { email: suggestion })}</p>
        <div className="mt-1 flex gap-4">
          <button
            type="button"
            className="font-medium text-brand-700 underline"
            onClick={() => {
              setEmail(suggestion);
              setShown(false);
            }}
          >
            {t('emailTypo.use_fix')}
          </button>
          <button
            type="button"
            className="text-slate-500 underline"
            onClick={() => {
              setKept(email.trim());
              setShown(false);
            }}
          >
            {t('emailTypo.keep')}
          </button>
        </div>
      </div>
    ) : null;

  return { hint, onBlur, confirmBeforeSubmit };
}
