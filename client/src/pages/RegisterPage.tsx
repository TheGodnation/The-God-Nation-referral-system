import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { PasswordInput } from '../components/PasswordInput';
import { api, ApiError } from '../lib/api';
import { usePublicSettings } from '../lib/usePublicSettings';
import { useMemberAuth } from '../lib/MemberAuthContext';
import { CAMEROON, CAMEROON_REGIONS, COUNTRIES, optionLabel } from '../lib/locations';

type Pathway = 'TRAINING' | 'DISCOVER_GROW';
type Step = 'start' | 'code' | 'finish';
const OTHER = '__other__';
type DetailField = 'name' | 'whatsapp' | 'country' | 'region' | 'division' | 'subdivision' | 'quarter' | 'city';

// The public join flow reached from a Leader/Member referral link or the
// homepage's Training/Discover&Grow CTA. Nothing is saved until screen 3
// (finish) succeeds: screen 1 collects only email + password (the pathway
// was already chosen via the ?pathway= query param before landing here);
// screen 2 confirms the emailed 6-digit code; screen 3 collects name, phone
// and location, which is the one moment a real account is created and the
// visitor is placed in a community — see server/src/routes/memberAuth.ts
// POST /signup/{start,check-code,finish}.
export function RegisterPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { supportWhatsappUrl, content } = usePublicSettings();
  const { refresh } = useMemberAuth();
  const contentLang = i18n.language.startsWith('fr') ? 'Fr' : 'En';
  const registrationPageText = content[`registrationPageText${contentLang}`] || undefined;

  const pathway: Pathway = params.get('pathway') === 'DISCOVER_GROW' ? 'DISCOVER_GROW' : 'TRAINING';
  const language = i18n.language?.startsWith('fr') ? 'fr' : 'en';

  const [step, setStep] = useState<Step>('start');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailRegistered, setEmailRegistered] = useState(false);
  const [resent, setResent] = useState(false);

  const [name, setName] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [countryChoice, setCountryChoice] = useState<string>(CAMEROON);
  const [otherCountry, setOtherCountry] = useState('');
  const [region, setRegion] = useState('');
  const [division, setDivision] = useState('');
  const [subdivision, setSubdivision] = useState('');
  const [quarter, setQuarter] = useState('');
  const [city, setCity] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<DetailField, string>>>({});
  const [duplicate, setDuplicate] = useState(false);

  const country = countryChoice === OTHER ? otherCountry.trim() : countryChoice;
  const inCameroon = country === CAMEROON;
  const title = pathway === 'DISCOVER_GROW' ? t('register.title_discover') : t('register.title_training');

  async function onStart(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setEmailRegistered(false);
    setSubmitting(true);
    try {
      await api.post('/api/member/auth/signup/start', { email: email.trim(), password, pathway, language });
      setStep('code');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EMAIL_ALREADY_REGISTERED') {
        setEmailRegistered(true);
        setError(t('register.error_email_registered'));
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(t('register.error_generic'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function onCheckCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const clean = code.replace(/\D/g, '');
    if (clean.length !== 6) {
      setError(t('register.code_need_six'));
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/api/member/auth/signup/check-code', { email: email.trim(), code: clean });
      setStep('finish');
    } catch {
      setError(t('register.code_bad'));
    } finally {
      setSubmitting(false);
    }
  }

  async function onResend() {
    setError(null);
    setResent(false);
    try {
      await api.post('/api/member/auth/signup/start', { email: email.trim(), password, pathway, language });
      setResent(true);
    } catch {
      setError(t('register.error_generic'));
    }
  }

  function fieldError(field: DetailField) {
    return fieldErrors[field] ? (
      <p className="mt-1 text-xs font-medium text-red-700" role="alert">
        {fieldErrors[field]}
      </p>
    ) : null;
  }

  async function onFinish(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDuplicate(false);
    setFieldErrors({});
    setSubmitting(true);
    try {
      await api.post('/api/member/auth/signup/finish', {
        email: email.trim(),
        code: code.replace(/\D/g, ''),
        name: name.trim(),
        whatsapp: whatsapp.trim(),
        country,
        ...(inCameroon
          ? { region, division: division.trim(), subdivision: subdivision.trim(), quarter: quarter.trim() }
          : { city: city.trim() }),
      });
      await refresh();
      navigate('/member/dashboard', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'PHONE_ALREADY_REGISTERED' || err.code === 'DUPLICATE')) {
        setDuplicate(true);
        setError(t('register.duplicate_error_message'));
      } else if (err instanceof ApiError && err.code === 'BAD_CODE') {
        setStep('code');
        setError(t('register.code_bad'));
      } else if (err instanceof ApiError) {
        setFieldErrors(err.field ? { [err.field as DetailField]: err.message } : {});
        setError(err.field ? null : err.message);
      } else {
        setError(t('register.finish_error_generic') ?? t('register.error_generic'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  function tryDifferentNumber() {
    setDuplicate(false);
    setError(null);
    setWhatsapp('');
  }

  return (
    <PageShell>
      <section className="mx-auto max-w-md px-4 py-12">
        <h1 className="text-2xl font-bold text-brand-900">{title}</h1>
        {registrationPageText && <p className="mt-2 text-sm text-slate-500">{registrationPageText}</p>}

        {step === 'start' && (
          <form onSubmit={onStart} className="mt-6 space-y-5" noValidate>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t('register.step_start')}</p>
            <div>
              <label className="label" htmlFor="register-email">
                {t('register.email_label')}
              </label>
              <input
                id="register-email"
                type="email"
                className="input"
                placeholder={t('register.email_placeholder') ?? ''}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div>
              <label className="label" htmlFor="register-password">
                {t('register.password_label')}
              </label>
              <PasswordInput id="register-password" value={password} onChange={setPassword} autoComplete="new-password" minLength={8} />
              <p className="mt-1 text-xs text-slate-500">{t('register.password_hint')}</p>
            </div>

            {error && (
              <div role="alert" className="space-y-2 rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                <p>{error}</p>
                {emailRegistered && (
                  <Link to="/member/login" className="font-medium text-brand-700 underline">
                    {t('register.sign_in_link')}
                  </Link>
                )}
              </div>
            )}

            <button type="submit" className="btn-primary w-full" disabled={submitting}>
              {submitting ? t('register.start_submitting') : t('register.start_submit')}
            </button>
          </form>
        )}

        {step === 'code' && (
          <form onSubmit={onCheckCode} className="mt-6 space-y-4" noValidate>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t('register.step_code')}</p>
            <p className="text-sm text-slate-600">{t('register.code_sent_to', { email: email.trim() })}</p>
            <div>
              <label className="label" htmlFor="register-code">
                {t('register.code_label')}
              </label>
              <input
                id="register-code"
                className="input text-center text-2xl tracking-[0.5em]"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="••••••"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              />
            </div>

            {error && (
              <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                {error}
              </div>
            )}
            {resent && <p className="text-sm text-green-700">{t('register.code_resent')}</p>}

            <button type="submit" className="btn-primary w-full" disabled={submitting}>
              {submitting ? t('register.code_checking') : t('register.code_submit')}
            </button>
            <div className="flex justify-between text-sm">
              <button type="button" className="text-brand-700 underline" onClick={onResend}>
                {t('register.code_resend')}
              </button>
              <button
                type="button"
                className="text-slate-500 underline"
                onClick={() => {
                  setStep('start');
                  setCode('');
                  setError(null);
                }}
              >
                {t('register.code_change_email')}
              </button>
            </div>
            <p className="text-xs text-slate-500">{t('register.code_spam_hint')}</p>
          </form>
        )}

        {step === 'finish' && (
          <form onSubmit={onFinish} className="mt-6 space-y-5" noValidate>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t('register.step_details')}</p>

            <div>
              <label className="label" htmlFor="register-name">
                {t('register.name_label')}
              </label>
              <input
                id="register-name"
                className="input"
                placeholder={t('register.name_placeholder') ?? ''}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={200}
                autoComplete="name"
              />
            </div>

            <div>
              <label className="label" htmlFor="register-phone">
                {t('register.phone_label')}
              </label>
              <input
                id="register-phone"
                className="input"
                placeholder={t('register.phone_placeholder') ?? ''}
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                required
                inputMode="tel"
                autoComplete="tel"
              />
              <p className="mt-1 text-xs text-slate-500">{t('register.phone_hint')}</p>
            </div>

            <div>
              <label className="label" htmlFor="register-country">
                {t('memberCompleteProfile.country_label')}
              </label>
              <select
                id="register-country"
                className="input"
                value={countryChoice}
                onChange={(e) => setCountryChoice(e.target.value)}
              >
                {COUNTRIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {optionLabel(c, i18n.language)}
                  </option>
                ))}
                <option value={OTHER}>{t('memberCompleteProfile.other_country')}</option>
              </select>
              {countryChoice === OTHER && (
                <input
                  aria-label={t('memberCompleteProfile.other_country_label')}
                  className="input mt-2"
                  placeholder={t('memberCompleteProfile.other_country_label') ?? ''}
                  value={otherCountry}
                  onChange={(e) => setOtherCountry(e.target.value)}
                />
              )}
            </div>

            {inCameroon ? (
              <>
                <div>
                  <label className="label" htmlFor="register-region">
                    {t('memberCompleteProfile.region_label')}
                  </label>
                  <select id="register-region" className="input" value={region} onChange={(e) => setRegion(e.target.value)}>
                    <option value="">{t('memberCompleteProfile.choose_region')}</option>
                    {CAMEROON_REGIONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {optionLabel(r, i18n.language)}
                      </option>
                    ))}
                  </select>
                  {fieldError('region')}
                </div>
                <div>
                  <label className="label" htmlFor="register-division">
                    {t('memberCompleteProfile.division_label')}
                  </label>
                  <input id="register-division" className="input" placeholder="Mfoundi" value={division} onChange={(e) => setDivision(e.target.value)} />
                  {fieldError('division')}
                </div>
                <div>
                  <label className="label" htmlFor="register-subdivision">
                    {t('memberCompleteProfile.subdivision_label')}
                  </label>
                  <input
                    id="register-subdivision"
                    className="input"
                    placeholder="Yaoundé III"
                    value={subdivision}
                    onChange={(e) => setSubdivision(e.target.value)}
                  />
                  {fieldError('subdivision')}
                </div>
                <div>
                  <label className="label" htmlFor="register-quarter">
                    {t('memberCompleteProfile.quarter_label')}
                  </label>
                  <input id="register-quarter" className="input" placeholder="Efoulan" value={quarter} onChange={(e) => setQuarter(e.target.value)} />
                  {fieldError('quarter')}
                </div>
              </>
            ) : (
              <div>
                <label className="label" htmlFor="register-city">
                  {t('memberCompleteProfile.city_label')}
                </label>
                <input id="register-city" className="input" value={city} onChange={(e) => setCity(e.target.value)} />
                {fieldError('city')}
              </div>
            )}

            {error && (
              <div role="alert" className="space-y-3 rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                <p>{error}</p>
                {duplicate && (
                  <div className="flex flex-col gap-2">
                    <button type="button" onClick={tryDifferentNumber} className="btn-secondary w-full text-xs">
                      {t('register.duplicate_try_different')}
                    </button>
                    {supportWhatsappUrl && (
                      <>
                        <p className="text-center text-xs font-semibold uppercase text-red-400">{t('register.duplicate_or')}</p>
                        <a
                          href={supportWhatsappUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="btn-primary w-full bg-green-600 text-center text-xs hover:bg-green-700"
                        >
                          {t('register.duplicate_contact_us')}
                        </a>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            <button type="submit" className="btn-primary w-full" disabled={submitting}>
              {submitting ? t('register.finish_submitting') : t('register.finish_submit')}
            </button>
          </form>
        )}
      </section>
    </PageShell>
  );
}
