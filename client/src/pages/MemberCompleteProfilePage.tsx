import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { api, ApiError } from '../lib/api';
import { useMemberAuth } from '../lib/MemberAuthContext';
import { EMPTY_LOCATION, LocationFields, locationCountry, locationPayload, validateLocation, type LocationValue } from '../components/member/LocationFields';

type Field = 'name' | 'country' | 'region' | 'division' | 'subdivision' | 'quarter';

// Step 2 of joining: shown right after the member clicks their emailed
// link. They give their name and where they live; the server then places
// them in a group automatically and we send them into the community.
export function MemberCompleteProfilePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { member, refresh } = useMemberAuth();

  // A brand-new sign-up has their email as a placeholder name — start empty.
  const initialName = member && member.name !== member.email ? member.name : '';
  const [name, setName] = useState(initialName);
  const [place, setPlace] = useState<LocationValue>(EMPTY_LOCATION);

  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const language = i18n.language?.startsWith('fr') ? 'fr' : 'en';

  function validate(): Partial<Record<Field, string>> {
    const e: Partial<Record<Field, string>> = {};
    const required = t('memberCompleteProfile.required');
    if (!name.trim()) e.name = required;
    Object.assign(e, validateLocation(place, required));
    return e;
  }

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setFormError(null);
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    setSubmitting(true);
    try {
      await api.post('/api/member/auth/complete-profile', {
        name: name.trim(),
        preferredLanguage: language,
        ...locationPayload(place),
      });
      await refresh();
      navigate('/member/dashboard', { replace: true });
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t('memberCompleteProfile.error_generic'));
    } finally {
      setSubmitting(false);
    }
  }

  function fieldError(field: Field) {
    return errors[field] ? (
      <p className="mt-1 text-xs font-medium text-red-700" role="alert">
        {errors[field]}
      </p>
    ) : null;
  }

  function textField(id: Field, label: string, value: string, set: (v: string) => void, placeholder?: string) {
    return (
      <div>
        <label className="label" htmlFor={`profile-${id}`}>
          {label}
        </label>
        <input
          id={`profile-${id}`}
          className="input"
          value={value}
          placeholder={placeholder}
          onChange={(e) => {
            set(e.target.value);
            if (errors[id]) setErrors({ ...errors, [id]: undefined });
          }}
        />
        {fieldError(id)}
      </div>
    );
  }

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-sm px-4 py-12">
        <h1 className="text-2xl font-bold text-brand-900">{t('memberCompleteProfile.title')}</h1>
        <p className="mt-2 text-sm text-slate-500">{t('memberCompleteProfile.subtitle')}</p>

        <form onSubmit={onSubmit} className="mt-6 space-y-5" noValidate>
          {textField('name', t('memberCompleteProfile.name_label'), name, setName)}

          <LocationFields value={place} onChange={(next) => { setPlace(next); setErrors({ name: errors.name }); }} idPrefix="profile" errors={errors} />

          {formError && (
            <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {formError}
            </div>
          )}

          <button type="submit" className="btn-primary w-full" disabled={submitting}>
            {submitting ? t('memberCompleteProfile.submitting') : t('memberCompleteProfile.submit')}
          </button>
        </form>
      </section>
    </PageShell>
  );
}
