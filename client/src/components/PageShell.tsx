import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from './LanguageSwitcher';

export function PageShell({ children, minimal = false }: { children: ReactNode; minimal?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="sticky top-0 z-10 border-b border-slate-100 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link to="/" className="text-base font-bold tracking-tight text-brand-900">
            THE GOD NATION
          </Link>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            {!minimal && (
              <Link to="/login" className="hidden text-sm font-medium text-brand-700 hover:underline sm:block">
                {t('nav.login')}
              </Link>
            )}
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-slate-100 px-4 py-6 text-center text-xs text-slate-400">
        The God Nation Media & Leadership Academy
      </footer>
    </div>
  );
}
