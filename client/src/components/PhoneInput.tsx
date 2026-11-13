import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_COUNTRY, dialOf, flagOf, fullNumber, sortedCountries, splitInternational } from '../lib/countries';

// A phone number box where the country is chosen from a list (Cameroon, +237, by default) and the
// country code is added by itself, so people only type their own number. Someone who types or pastes a
// number starting with "+" is placed in the right country. `onChange` gets the whole number ("+2376…"),
// or "" while nothing is typed.
export function PhoneInput({
  id,
  onChange,
  placeholder = '6XX XXX XXX',
  required,
  countryLabel,
}: {
  id: string;
  onChange: (full: string) => void;
  placeholder?: string;
  required?: boolean;
  countryLabel?: string;
}) {
  const { i18n, t } = useTranslation();
  const lang = i18n.language?.startsWith('fr') ? 'fr' : 'en';
  const countries = useMemo(() => sortedCountries(lang), [lang]);
  const [iso, setIso] = useState(DEFAULT_COUNTRY);
  const [national, setNational] = useState('');

  const update = (nextIso: string, nextNational: string) => {
    setIso(nextIso);
    setNational(nextNational);
    onChange(fullNumber(nextIso, nextNational));
  };

  return (
    <div className="flex gap-2">
      <select
        aria-label={countryLabel ?? t('phoneInput.country')}
        className="input w-auto max-w-[42%] shrink-0 px-2"
        value={iso}
        onChange={(e) => update(e.target.value, national)}
        data-testid="phone-country"
      >
        {countries.map((c) => (
          <option key={c.iso} value={c.iso}>
            {flagOf(c.iso)} {c.name} (+{c.dial})
          </option>
        ))}
      </select>
      <div className="flex min-w-0 flex-1 items-center rounded-lg border border-slate-300 bg-white focus-within:ring-2 focus-within:ring-brand-500">
        <span className="select-none pl-3 text-slate-500" data-testid="phone-code">
          +{dialOf(iso)}
        </span>
        <input
          id={id}
          className="min-w-0 flex-1 rounded-lg border-0 bg-transparent px-2 py-2.5 outline-none"
          placeholder={placeholder}
          value={national}
          required={required}
          inputMode="tel"
          autoComplete="tel-national"
          onChange={(e) => {
            const typed = e.target.value;
            // A whole number typed or pasted with its "+": choose the country and keep only the rest.
            const split = splitInternational(typed);
            if (split) update(split.iso, split.national);
            else update(iso, typed);
          }}
        />
      </div>
    </div>
  );
}
