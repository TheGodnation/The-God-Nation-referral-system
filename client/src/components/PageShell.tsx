import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from './LanguageSwitcher';
import { usePublicSettings } from '../lib/usePublicSettings';

// The public home page's own top bar: section links on wide screens, and the
// two ways in (join, sign in).
const HOME_LINKS = [
  ['#top', 'home'],
  ['#vision', 'vision'],
  ['#offer', 'offer'],
  ['#community', 'community'],
  ['#leadership', 'leadership'],
  ['#mission', 'mission'],
] as const;

export function PageShell({ children, minimal = false, homeNav = false }: { children: ReactNode; minimal?: boolean; homeNav?: boolean }) {
  const { t, i18n } = useTranslation();
  const { content } = usePublicSettings();
  const lang = i18n.language.startsWith('fr') ? 'Fr' : 'En';
  const c = (key: string): string | undefined => content[`${key}${lang}`] || undefined;

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="sticky top-0 z-10 border-b border-slate-100 bg-white/90 backdrop-blur">
        <div className={`mx-auto flex items-center justify-between px-4 py-3 ${homeNav ? 'max-w-6xl' : 'max-w-5xl'}`}>
          <Link to="/" className="flex items-center gap-2 whitespace-nowrap text-base font-bold tracking-tight text-brand-900">
            <img src="/icons/icon-192.png" alt="" className="h-8 w-8" />
            THE GOD NATION
          </Link>
          {homeNav && (
            <nav aria-label={t('homePage.nav_label') ?? ''} className="hidden items-center gap-4 whitespace-nowrap text-sm font-medium text-slate-600 2xl:flex">
              {HOME_LINKS.map(([href, key]) => (
                <a key={key} href={href} className="hover:text-brand-700">
                  {t(`homePage.nav_${key}`)}
                </a>
              ))}
            </nav>
          )}
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            {homeNav && (
              <>
                <Link to="/member/join" className="hidden whitespace-nowrap rounded-lg bg-gold-500 px-4 py-2 text-sm font-semibold text-brand-950 hover:bg-gold-400 sm:inline-block">
                  {t('homePage.join')}
                </Link>
                <Link to="/member/login" className="hidden whitespace-nowrap text-sm font-medium text-brand-700 hover:underline 2xl:block">
                  {t('homePage.sign_in_short')}
                </Link>
              </>
            )}
            {!minimal && !homeNav && (
              <Link to="/login" className="hidden text-sm font-medium text-brand-700 hover:underline sm:block">
                {t('nav.login')}
              </Link>
            )}
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-slate-100 px-4 py-6 text-center text-xs text-slate-400">
        <nav className="mb-3 flex flex-wrap justify-center gap-x-4 gap-y-1">
          <Link to="/teachings" className="hover:text-brand-700 hover:underline">
            {t('nav.teachings')}
          </Link>
          <Link to="/announcements" className="hover:text-brand-700 hover:underline">
            {t('nav.announcements')}
          </Link>
          <Link to="/contact" className="hover:text-brand-700 hover:underline">
            {t('nav.contact')}
          </Link>
          <Link to="/privacy" className="hover:text-brand-700 hover:underline">
            {t('privacy.nav')}
          </Link>
          <Link to="/member/login" className="hover:text-brand-700 hover:underline">
            {t('nav.memberLogin')}
          </Link>
        </nav>
        <p>{c('footer') || 'The God Nation'}</p>
        {c('contactInfo') && <p className="mt-1">{c('contactInfo')}</p>}
      </footer>
    </div>
  );
}
