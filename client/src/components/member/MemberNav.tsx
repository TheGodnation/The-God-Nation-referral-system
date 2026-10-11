import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

// The member app's bottom bar, like WhatsApp: Chats · Updates · Learn ·
// People · Me. Fixed to the bottom of the screen; the spacer keeps page
// content from hiding behind it.
const TABS = [
  {
    to: '/member/chats',
    key: 'chats',
    icon: 'M4 5h16v10H8l-4 4V5z',
  },
  {
    to: '/member/updates',
    key: 'updates',
    icon: 'M4 4h16v4H4zM4 10h10v10H4zM16 10h4v10h-4z',
  },
  {
    to: '/member/learn',
    key: 'learn',
    icon: 'M3 6l9-3 9 3-9 3-9-3zm3 2v5c0 1.7 2.7 3 6 3s6-1.3 6-3V8',
  },
  {
    to: '/member/people',
    key: 'people',
    icon: 'M9 11a3 3 0 100-6 3 3 0 000 6zm7 0a3 3 0 100-6M3 20c0-3 2.7-5 6-5s6 2 6 5m2-5c2.5 0 4 1.7 4 5',
  },
  {
    to: '/member/me',
    key: 'me',
    icon: 'M12 12a4 4 0 100-8 4 4 0 000 8zm-8 9c0-4 3.6-6 8-6s8 2 8 6',
  },
] as const;

export function MemberNav() {
  const { t } = useTranslation();
  return (
    <>
      <div aria-hidden="true" className="h-20" />
      <nav
        aria-label={t('memberNav.label') ?? ''}
        className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <ul className="mx-auto flex max-w-2xl">
          {TABS.map((tab) => (
            <li key={tab.key} className="flex-1">
              <NavLink
                to={tab.to}
                className={({ isActive }) =>
                  `flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${isActive ? 'text-brand-700' : 'text-slate-500'}`
                }
              >
                {({ isActive }) => (
                  <>
                    <span className={`flex h-7 w-14 items-center justify-center rounded-full ${isActive ? 'bg-brand-100' : ''}`}>
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d={tab.icon} />
                      </svg>
                    </span>
                    {t(`memberNav.${tab.key}`)}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
