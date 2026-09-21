import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { api, ApiError } from '../lib/api';
import { useMemberAuth } from '../lib/MemberAuthContext';

// Phase 3C: consumes the magic-link token from the URL. Auto-submits on
// load (the member already proved intent by opening the emailed link) —
// known tradeoff: an email client's link-prescanning could consume the
// token before the member opens it, same as any magic-link scheme; the
// failure is safe (a clear "expired/used" message with a way to request a
// new link), never a silent wrong-account login.
export function MemberLoginConfirmPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const navigate = useNavigate();
  const { refresh } = useMemberAuth();

  const [status, setStatus] = useState<'working' | 'success' | 'error'>('working');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setError(t('memberLoginConfirm.missing_token'));
      return;
    }
    api
      .post('/api/member/auth/consume', { token })
      .then(async () => {
        await refresh();
        setStatus('success');
        setTimeout(() => navigate('/member/dashboard'), 1000);
      })
      .catch((err) => {
        setStatus('error');
        setError(err instanceof ApiError ? err.message : t('memberLoginConfirm.error_generic'));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-sm px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-brand-900">{t('memberLoginConfirm.title')}</h1>

        {status === 'working' && <p className="mt-6 text-slate-500">{t('memberLoginConfirm.working')}</p>}

        {status === 'success' && (
          <p className="mt-6 rounded-lg bg-green-50 px-4 py-3 text-sm font-medium text-green-800">
            {t('memberLoginConfirm.success')}
          </p>
        )}

        {status === 'error' && (
          <div className="mt-6 space-y-3">
            <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {error}
            </p>
            <Link to="/member/login" className="btn-primary inline-flex w-full">
              {t('memberLoginConfirm.request_new_link')}
            </Link>
          </div>
        )}
      </section>
    </PageShell>
  );
}
