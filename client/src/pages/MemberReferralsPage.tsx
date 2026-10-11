import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { MemberNav } from '../components/member/MemberNav';
import { Avatar } from '../components/Avatar';
import { api } from '../lib/api';

interface ReferredPerson {
  personId: string;
  name: string;
  photoUrl: string | null;
  joinedAt: string;
}

// "My Referrals": a Member's own referral link, and everyone who joined
// the app through it (auto-friended at signup — see memberAuth.ts). Mirrors
// the Leader dashboard's Invite/Referrals panels, kept lightweight and
// scoped to just the link and the list.
export function MemberReferralsPage() {
  const { t, i18n } = useTranslation();
  const [links, setLinks] = useState<{ en: string; fr: string } | null>(null);
  const [items, setItems] = useState<ReferredPerson[] | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.get<{ links: { en: string; fr: string } }>('/api/member/referrals/links').then((r) => setLinks(r.links));
    api.get<{ items: ReferredPerson[] }>('/api/member/referrals/mine?pageSize=50').then((r) => setItems(r.items)).catch(() => setItems([]));
  }, []);

  const primaryLink = links ? (i18n.language.startsWith('fr') ? links.fr : links.en) : null;

  async function copyLink() {
    if (!primaryLink) return;
    try {
      await navigator.clipboard.writeText(primaryLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable — no-op; the link is still visible.
    }
  }

  async function webShare() {
    if (!primaryLink || !navigator.share) return;
    try {
      await navigator.share({ title: 'The God Nation', text: t('myReferrals.share_message', { link: primaryLink }), url: primaryLink });
    } catch {
      // user cancelled — no-op
    }
  }

  const whatsappShareUrl = primaryLink
    ? `https://wa.me/?text=${encodeURIComponent(t('myReferrals.share_message', { link: primaryLink }) ?? '')}`
    : null;

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-brand-900">{t('myReferrals.title')}</h1>
          <Link to="/member/me" className="text-sm text-brand-700 underline">
            {t('myReferrals.back')}
          </Link>
        </div>

        <div className="space-y-6">
          <section className="card space-y-3">
            <h2 className="font-semibold text-brand-900">{t('myReferrals.link_title')}</h2>
            <p className="text-sm text-slate-500">{t('myReferrals.link_help')}</p>
            {primaryLink ? (
              <>
                <p className="break-all rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{primaryLink}</p>
                <div className="flex flex-wrap gap-2">
                  {whatsappShareUrl && (
                    <a href={whatsappShareUrl} target="_blank" rel="noreferrer" className="btn-primary bg-green-600 hover:bg-green-700">
                      {t('myReferrals.share_whatsapp')}
                    </a>
                  )}
                  <button type="button" onClick={copyLink} className="btn-secondary">
                    {t('myReferrals.copy_link')}
                  </button>
                  {typeof navigator !== 'undefined' && 'share' in navigator && (
                    <button type="button" onClick={webShare} className="btn-secondary">
                      {t('myReferrals.share_generic')}
                    </button>
                  )}
                </div>
                {copied && <p className="text-sm text-green-700">{t('myReferrals.link_copied')}</p>}
              </>
            ) : (
              <p className="text-sm text-slate-400">{t('people.loading')}</p>
            )}
          </section>

          <section className="card space-y-2">
            <h2 className="font-semibold text-brand-900">{t('myReferrals.list_title')}</h2>
            {items === null ? (
              <p className="text-sm text-slate-400">{t('people.loading')}</p>
            ) : items.length === 0 ? (
              <p className="text-sm text-slate-500">{t('myReferrals.list_empty')}</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {items.map((p) => (
                  <li key={p.personId}>
                    <Link to={`/member/people/${p.personId}`} className="flex items-center gap-3 py-2">
                      <Avatar name={p.name} photoUrl={p.photoUrl} size={44} />
                      <span>
                        <span className="block font-semibold text-slate-800">{p.name}</span>
                        <span className="block text-xs text-slate-500">
                          {t('myReferrals.joined_on', { date: new Date(p.joinedAt).toLocaleDateString() })}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <MemberNav />
      </section>
    </PageShell>
  );
}
