import { useTranslation } from 'react-i18next';

// Shown under a text box only near or past its limit: "1,200 characters
// left", or "120 characters too long — please shorten it". Nothing is ever
// cut by itself.
export function LengthNote({ value, max, className = '' }: { value: string; max: number; className?: string }) {
  const { t, i18n } = useTranslation();
  const length = value.trim().length;
  if (length < max * 0.9) return null;
  const n = (x: number) => x.toLocaleString(i18n.language.startsWith('fr') ? 'fr-FR' : 'en-GB');
  const over = length - max;
  return (
    <p role={over > 0 ? 'alert' : undefined} className={`text-xs ${over > 0 ? 'font-medium text-red-700' : 'text-slate-500'} ${className}`}>
      {over > 0 ? t('limits.too_long', { count: over, over: n(over), max: n(max) }) : t('limits.left', { count: max - length, left: n(max - length) })}
    </p>
  );
}
