import { useTranslation } from 'react-i18next';

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();

  function setLang(lang: 'en' | 'fr') {
    i18n.changeLanguage(lang);
  }

  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm">
      <button
        type="button"
        onClick={() => setLang('en')}
        className={`rounded-md px-3 py-1.5 font-medium transition ${
          i18n.language.startsWith('en') ? 'bg-brand-600 text-white' : 'text-slate-600'
        }`}
      >
        {t('common.language_en')}
      </button>
      <button
        type="button"
        onClick={() => setLang('fr')}
        className={`rounded-md px-3 py-1.5 font-medium transition ${
          i18n.language.startsWith('fr') ? 'bg-brand-600 text-white' : 'text-slate-600'
        }`}
      >
        {t('common.language_fr')}
      </button>
    </div>
  );
}
