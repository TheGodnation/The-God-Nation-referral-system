import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

// Two tabs at the top of the Home page: "Home" and "About the God Nation".
// On the Home page the bell sits at the end of the same row (`trailing`),
// so the page needs no separate title row and more of the content shows.
export function HomeAboutTabs({ active, trailing }: { active: 'home' | 'about'; trailing?: ReactNode }) {
  const { t } = useTranslation();
  // The open tab is deep blue with a gold underline; the other is white with blue text.
  const tab = (isActive: boolean) =>
    `whitespace-nowrap rounded-full ${trailing ? 'px-3' : 'px-4'} py-1.5 text-sm font-semibold no-underline ${isActive ? 'border-b-[3px] border-gold-400 bg-brand-700 text-white shadow' : `${trailing ? 'bg-brand-50' : 'bg-white shadow-sm'} text-brand-700`}`;
  const nav = (
    <nav className={`flex gap-2 ${trailing ? '' : 'px-4 sm:px-0'}`} aria-label={t('aboutGodNation.tabs_label') ?? ''}>
      <Link to="/member/updates" aria-current={active === 'home' ? 'page' : undefined} className={tab(active === 'home')}>
        {t('memberNav.home')}
      </Link>
      <Link to="/member/about" aria-current={active === 'about' ? 'page' : undefined} className={tab(active === 'about')}>
        {t('aboutGodNation.tab')}
      </Link>
    </nav>
  );
  if (!trailing) return nav;
  return (
    <div className="flex items-center justify-between gap-2 border-t-4 border-gold-400 bg-white px-4 py-2 sm:rounded-xl sm:shadow-sm">
      {nav}
      {trailing}
    </div>
  );
}
