import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

// Two tabs at the top of the Home page: "Home" and "About the God Nation".
export function HomeAboutTabs({ active }: { active: 'home' | 'about' }) {
  const { t } = useTranslation();
  // The open tab is deep blue with a gold underline; the other is white with blue text.
  const tab = (isActive: boolean) =>
    `rounded-full px-4 py-1.5 text-sm font-semibold no-underline ${isActive ? 'border-b-[3px] border-gold-400 bg-brand-700 text-white shadow' : 'bg-white text-brand-700 shadow-sm'}`;
  return (
    <nav className="flex gap-2 px-4 sm:px-0" aria-label={t('aboutGodNation.tabs_label') ?? ''}>
      <Link to="/member/updates" aria-current={active === 'home' ? 'page' : undefined} className={tab(active === 'home')}>
        {t('memberNav.home')}
      </Link>
      <Link to="/member/about" aria-current={active === 'about' ? 'page' : undefined} className={tab(active === 'about')}>
        {t('aboutGodNation.tab')}
      </Link>
    </nav>
  );
}
