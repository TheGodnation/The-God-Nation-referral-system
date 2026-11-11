import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { checkPushOnThisDevice } from '../../lib/push';
import { useInstallPrompt } from '../../lib/installPrompt';
import { usePublicSettings } from '../../lib/usePublicSettings';
import { communityPlaces, followPlaces } from '../socialPlatforms';
import { CommunityChoices } from '../CommunityChoices';
import { EnableNotificationsBanner } from './EnableNotificationsBanner';
import { GuideLink } from './GuideLink';

export interface OnboardingStatus {
  profileDone: boolean;
  notificationsOn: boolean;
  communityTapped: boolean;
  /** The member said, themselves, that they have joined (a link tap alone is never counted as joining). */
  communityConfirmed?: boolean;
  existingMember?: boolean;
  agreementCommunityId?: string | null;
  dismissed: boolean;
  installed: boolean;
  firstSignInAt: string | null;
}

// Places left out of the welcome step (YouTube is a channel to watch, not a place to join).
const HIDDEN_PLACES = ['youtube'];

type StepKey = 'notifications' | 'install' | 'community' | 'agreement';

/** What the member has done so far. Anything that can't be read counts as "not yet", never as an error. */
function useOnboarding() {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [deviceHasPush, setDeviceHasPush] = useState(false);
  const [tapped, setTapped] = useState(false);
  const [confirmedLocal, setConfirmedLocal] = useState(false);
  const install = useInstallPrompt();

  const reload = useCallback(() => {
    void api.get<OnboardingStatus>('/api/member/onboarding').then(setStatus).catch(() => {});
  }, []);
  useEffect(() => {
    reload();
    void checkPushOnThisDevice().then((s) => setDeviceHasPush(s === 'subscribed')).catch(() => {});
  }, [reload]);

  // Seen running as an installed app (or just installed): tell the server once, so the step stays ticked on every device.
  const installSeen = install.installed;
  const alreadyRecorded = !!status?.installed;
  const statusLoaded = !!status;
  useEffect(() => {
    if (installSeen && statusLoaded && !alreadyRecorded) {
      void api.post('/api/member/onboarding/installed', {}).then(reload).catch(() => {});
    }
  }, [installSeen, statusLoaded, alreadyRecorded, reload]);

  const done: Record<StepKey, boolean> = {
    notifications: deviceHasPush || !!status?.notificationsOn,
    install: install.installed || !!status?.installed,
    // People who were already here (most came from WhatsApp) are not asked to join the community again. For everyone
    // else the step is done only when they say they have joined: tapping a link proves nothing about joining.
    community: confirmedLocal || !!status?.communityConfirmed || !!status?.existingMember,
    // Nothing waiting (they agreed, or they were here before the rules started) counts as done.
    agreement: !!status && !status.agreementCommunityId,
  };
  const total = 4;
  const count = Object.values(done).filter(Boolean).length;
  const tappedAny = tapped || !!status?.communityTapped;
  const confirmJoined = useCallback(() => {
    setConfirmedLocal(true);
    void api.post('/api/member/onboarding/community-joined', {}).then(reload).catch(() => {});
  }, [reload]);
  return { status, done, count, total, install, markTapped: () => setTapped(true), tappedAny, confirmJoined, reload };
}

const STEP_ORDER: StepKey[] = ['notifications', 'install', 'community', 'agreement'];

/**
 * The community places to join, and, once one was tapped, an honest question: we cannot see whether they really joined
 * (the link opens another app), so they tell us.
 */
export function JoinCommunity({ tappedAny, confirmed, onTap, onConfirm, hideWhenEmpty = false }: { tappedAny: boolean; confirmed: boolean; onTap: (platform: string) => void; onConfirm: () => void; hideWhenEmpty?: boolean }) {
  const { t, i18n } = useTranslation();
  const settings = usePublicSettings();
  const lang = i18n.language?.startsWith('fr') ? 'fr' : 'en';
  const visible = (x: { platform: string }) => !HIDDEN_PLACES.includes(x.platform);
  const anyPlace = communityPlaces(settings, lang).filter(visible).length + followPlaces(settings).filter(visible).length > 0;
  if (!anyPlace && hideWhenEmpty) return null;
  if (!anyPlace) return <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600" data-testid="no-places">{t('onboarding.no_places')}</p>;
  return (
    <div>
      <CommunityChoices settings={settings} onTap={onTap} hide={HIDDEN_PLACES} />
      {confirmed ? (
        <p role="status" className="mt-2 text-xs text-emerald-700">{t('onboarding.joined_thanks')}</p>
      ) : tappedAny ? (
        <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2" data-testid="confirm-joined-box">
          <p className="text-xs text-slate-600">{t('onboarding.joined_ask')}</p>
          <button type="button" className="btn-primary mt-1.5 px-3 py-1.5 text-sm" onClick={onConfirm} data-testid="confirm-joined">
            {t('onboarding.joined_button')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Tick({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${on ? 'bg-emerald-600 text-white' : 'border border-slate-300 bg-white text-slate-400'}`}
    >
      {on ? '✓' : ''}
    </span>
  );
}

/**
 * The welcome page right after the details form: a few small steps, none of them compulsory. It always appears,
 * whether or not community links are set up. Each step shows done or not yet, and the member goes on whenever they like.
 */
/** The install step as a short roadmap for this phone: one tap where the browser allows it, numbered steps where not. */
function InstallRoadmap({ install }: { install: ReturnType<typeof useInstallPrompt> }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const device = install.ios ? 'ios' : install.android ? 'android' : 'desktop';
  const steps = [1, 2, 3, 4, 5].map((n) => ({ n, key: `onboarding.install_${device}_${n}` })).filter((s) => i18nHas(t, s.key));
  return (
    <div data-testid="install-roadmap">
      {install.inAppBrowser && (
        <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="install-inapp">{t('onboarding.install_inapp')}</p>
      )}
      {install.canPrompt && (
        <div className="mb-2">
          <p className="text-xs text-slate-600">{t('installApp.body')}</p>
          <button
            type="button"
            disabled={busy}
            className="btn-primary mt-1.5 px-3 py-1.5 text-sm disabled:opacity-60"
            onClick={() => {
              setBusy(true);
              void install.install().finally(() => setBusy(false));
            }}
            data-testid="install-now"
          >
            {t('installApp.button')}
          </button>
          <p className="mt-2 text-xs text-slate-500">{t('onboarding.install_or_manual')}</p>
        </div>
      )}
      <ol className="space-y-1.5 text-xs text-slate-700" data-testid={`install-steps-${device}`}>
        {steps.map((s, i) => (
          <li key={s.n} className="flex gap-2">
            <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[10px] font-bold text-brand-800">{i + 1}</span>
            <span>{t(s.key)}</span>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-xs text-slate-500">{t('onboarding.install_recorded')}</p>
      <GuideLink href="/notifications-guide/" className="mt-1 inline-block text-xs font-semibold text-brand-700 underline">
        {t('onboarding.install_pictures')}
      </GuideLink>
    </div>
  );
}

const i18nHas = (t: (k: string) => string, key: string) => t(key) !== key;

export function OnboardingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { status, done, count, total, install, markTapped, tappedAny, confirmJoined } = useOnboarding();

  function onTap(platform: string) {
    markTapped();
    void api.post('/api/member/group-link-click', { platform }).catch(() => {});
  }

  return (
    <section className="mx-auto max-w-sm px-4 py-10" data-testid="join-group">
      <h1 className="text-center text-2xl font-bold text-brand-900">{t('onboarding.title')}</h1>
      <p className="mb-1 mt-2 text-center text-sm text-slate-600">{t('onboarding.intro')}</p>
      <p className="mb-5 text-center text-xs font-semibold text-slate-500" data-testid="onboarding-progress">
        {t('onboarding.progress', { done: count, total })}
      </p>

      <ol className="space-y-4">
        <li className="flex gap-3" data-testid="step-notifications">
          <Tick on={done.notifications} />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-slate-900">{t('onboarding.step_notifications')}</p>
            {done.notifications ? <p className="text-xs text-emerald-700">{t('onboarding.done')}</p> : <EnableNotificationsBanner className="mt-1" />}
          </div>
        </li>

        <li className="flex gap-3" data-testid="step-install">
          <Tick on={done.install} />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-slate-900">{t('onboarding.step_install')}</p>
            {done.install ? (
              <p className="text-xs text-emerald-700">{t('onboarding.done')}</p>
            ) : (
              <InstallRoadmap install={install} />
            )}
          </div>
        </li>

        <li className="flex gap-3" data-testid="step-community">
          <Tick on={done.community} />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-slate-900">{t('onboarding.step_community')}</p>
            <p className="mb-2 text-xs text-slate-600">{t('onboarding.community_body')}</p>
            {done.community && status?.existingMember ? (
              <p className="text-xs text-emerald-700">{t('onboarding.done')}</p>
            ) : (
              <JoinCommunity tappedAny={tappedAny} confirmed={done.community} onTap={onTap} onConfirm={confirmJoined} />
            )}
          </div>
        </li>

        <li className="flex gap-3" data-testid="step-agreement">
          <Tick on={done.agreement} />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-slate-900">{t('onboarding.step_agreement')}</p>
            {done.agreement ? (
              <p className="text-xs text-emerald-700">{t('onboarding.done')}</p>
            ) : (
              <>
                <p className="text-xs text-slate-600">{t('onboarding.agreement_body')}</p>
                {status?.agreementCommunityId && (
                  <Link to={`/member/chats/group/${status.agreementCommunityId}`} className="btn-primary mt-1.5 inline-block px-3 py-1.5 text-sm no-underline" data-testid="open-assembly">
                    {t('onboarding.agreement_button')}
                  </Link>
                )}
              </>
            )}
          </div>
        </li>
      </ol>

      <div className="mt-8 text-center">
        <button type="button" onClick={() => navigate('/member/chats', { replace: true })} className="btn-primary px-5 py-2" data-testid="join-group-continue">
          {count > 0 || tappedAny ? t('joinGroup.continue') : t('joinGroup.skip')}
        </button>
        <p className="mt-2 text-xs text-slate-500">{t('onboarding.anytime')}</p>
      </div>
    </section>
  );
}

/**
 * "Get started" on Chats and Home: how far along the member is, the next step, and a way to continue or close it.
 * Appears for every member who has not finished or closed it (existing members too); shows nothing while loading
 * or if the status can't be read.
 */
export function GetStartedCard() {
  const { t } = useTranslation();
  const { status, done, count, total } = useOnboarding();
  const [closed, setClosed] = useState(false);
  if (!status || status.dismissed || closed || count >= total) return null;
  const next = STEP_ORDER.find((k) => !done[k]) ?? 'agreement';

  function close() {
    setClosed(true);
    void api.post('/api/member/onboarding/dismiss', {}).catch(() => {});
  }

  return (
    <div className="mb-4 rounded-xl border border-brand-100 bg-white p-3 shadow-sm" data-testid="get-started-card">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-brand-900">{t('onboarding.card_title')}</p>
          <p className="text-xs text-slate-600" data-testid="get-started-progress">{t('onboarding.progress', { done: count, total })}</p>
          <p className="mt-1 text-sm text-slate-700">{t(`onboarding.next_${next}`)}</p>
        </div>
        <button type="button" aria-label={t('onboarding.close') ?? ''} className="px-1 leading-6 text-slate-500" onClick={close} data-testid="get-started-close">
          ✕
        </button>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
        <div className="h-full bg-emerald-600" style={{ width: `${Math.round((count / total) * 100)}%` }} />
      </div>
      <Link to="/member/welcome-group" className="btn-primary mt-3 inline-block px-4 py-1.5 text-sm no-underline" data-testid="get-started-continue">
        {t('onboarding.card_button')}
      </Link>
    </div>
  );
}

/**
 * A card on Chats for a new member who has not yet said they joined the welcome community: the places to join, and an
 * honest "tell us when you have joined". Never shown to existing members, once they confirm, or after they close it.
 */
export function CommunityJoinCard() {
  const { t, i18n } = useTranslation();
  const settings = usePublicSettings();
  const { status, done, tappedAny, markTapped, confirmJoined } = useOnboarding();
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem('communityCardHidden') === '1';
    } catch {
      return false;
    }
  });
  if (!status || hidden || status.existingMember || done.community || !settings.loaded) return null;
  const lang = i18n.language?.startsWith('fr') ? 'fr' : 'en';
  if (communityPlaces(settings, lang).filter((x) => !HIDDEN_PLACES.includes(x.platform)).length === 0) return null;

  function close() {
    setHidden(true);
    try {
      localStorage.setItem('communityCardHidden', '1');
    } catch {
      /* private mode */
    }
  }

  return (
    <div className="mb-4 rounded-xl border border-brand-100 bg-white p-3 shadow-sm" data-testid="community-join-card">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-brand-900">{t('onboarding.step_community')}</p>
          <p className="mb-2 text-xs text-slate-600">{t('onboarding.community_body')}</p>
        </div>
        <button type="button" aria-label={t('onboarding.close') ?? ''} className="px-1 leading-6 text-slate-500" onClick={close} data-testid="community-card-close">
          ✕
        </button>
      </div>
      <JoinCommunity
        tappedAny={tappedAny}
        confirmed={done.community}
        onTap={(platform) => {
          markTapped();
          void api.post('/api/member/group-link-click', { platform }).catch(() => {});
        }}
        onConfirm={confirmJoined}
        hideWhenEmpty
      />
    </div>
  );
}
