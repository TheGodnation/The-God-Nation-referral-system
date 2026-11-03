import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { buildLink, PRESETS, type Destination, type Preset } from '../../lib/linkBuilder';

// Makes a properly tagged link so the Growth report can tell which ad, post or message
// brought each person. Works in the browser only; nothing is sent anywhere.
export function LinkBuilder() {
  const { t } = useTranslation();
  const [destination, setDestination] = useState<Destination>('join');
  const [preset, setPreset] = useState<Preset>('facebook');
  const [source, setSource] = useState(PRESETS.facebook.source);
  const [medium, setMedium] = useState(PRESETS.facebook.medium);
  const [campaign, setCampaign] = useState('');
  const [content, setContent] = useState('');
  const [lang, setLang] = useState<'' | 'en' | 'fr'>('');
  const [copied, setCopied] = useState<string | null>(null);

  const built = buildLink({ origin: window.location.origin, destination, preset, source, medium, campaign, content, lang });

  function choose(p: Preset) {
    setPreset(p);
    setSource(PRESETS[p].source);
    setMedium(PRESETS[p].medium);
  }

  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
    } catch {
      setCopied(null);
    }
  }

  const out = (key: string, label: string, value: string) => (
    <div>
      <p className="text-xs font-medium text-slate-600">{label}</p>
      <div className="mt-1 flex gap-2">
        <input readOnly className="input flex-1 font-mono text-xs" value={value} onFocus={(e) => e.currentTarget.select()} aria-label={label} />
        <button type="button" className="btn-secondary shrink-0" onClick={() => void copy(key, value)}>
          {copied === key ? t('linkBuilder.copied') : t('linkBuilder.copy')}
        </button>
      </div>
    </div>
  );

  return (
    <div className="card space-y-3" data-testid="link-builder">
      <h2 className="font-semibold text-brand-900">{t('linkBuilder.title')}</h2>
      <p className="text-xs text-slate-500">{t('linkBuilder.help')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="lb-dest">{t('linkBuilder.destination')}</label>
          <select id="lb-dest" className="input" value={destination} onChange={(e) => setDestination(e.target.value as Destination)}>
            <option value="join">{t('linkBuilder.dest_join')}</option>
            <option value="home">{t('linkBuilder.dest_home')}</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="lb-where">{t('linkBuilder.where')}</label>
          <select id="lb-where" className="input" value={preset} onChange={(e) => choose(e.target.value as Preset)}>
            {(Object.keys(PRESETS) as Preset[]).map((p) => (
              <option key={p} value={p}>{t(`linkBuilder.preset_${p}`)}</option>
            ))}
          </select>
        </div>
        {preset === 'other' && (
          <>
            <div>
              <label className="label" htmlFor="lb-source">{t('linkBuilder.source')}</label>
              <input id="lb-source" className="input" value={source} onChange={(e) => setSource(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="lb-medium">{t('linkBuilder.medium')}</label>
              <input id="lb-medium" className="input" value={medium} onChange={(e) => setMedium(e.target.value)} />
            </div>
          </>
        )}
        <div>
          <label className="label" htmlFor="lb-campaign">{t('linkBuilder.campaign')}</label>
          <input id="lb-campaign" className="input" value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder={t('linkBuilder.campaign_ph')} />
        </div>
        <div>
          <label className="label" htmlFor="lb-content">{t('linkBuilder.content')}</label>
          <input id="lb-content" className="input" value={content} onChange={(e) => setContent(e.target.value)} placeholder={t('linkBuilder.content_ph')} />
        </div>
        <div>
          <label className="label" htmlFor="lb-lang">{t('linkBuilder.lang')}</label>
          <select id="lb-lang" className="input" value={lang} onChange={(e) => setLang(e.target.value as '' | 'en' | 'fr')}>
            <option value="">{t('linkBuilder.lang_any')}</option>
            <option value="en">English</option>
            <option value="fr">Français</option>
          </select>
        </div>
      </div>
      {out('link', t('linkBuilder.link'), built.link)}
      {built.dynamicParams && (
        <div className="space-y-2 rounded-lg bg-slate-50 p-3">
          <p className="text-xs text-slate-600">{t(`linkBuilder.dynamic_help_${preset === 'instagram' ? 'facebook' : preset}`)}</p>
          {out('params', t('linkBuilder.params'), built.dynamicParams)}
          {out('dynlink', t('linkBuilder.dynlink'), built.dynamicLink)}
        </div>
      )}
    </div>
  );
}
