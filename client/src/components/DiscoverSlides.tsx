import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChartIcon, ChatHeartIcon, CompassIcon, GlobeIcon, GraduationCapIcon, HeartHandsIcon, MediaPlayIcon, OpenBookIcon, SproutIcon, UsersIcon } from './Icons';

type IconType = (p: { className?: string }) => JSX.Element;

const SLIDES: { n: number; Icon: IconType; glow: string }[] = [
  { n: 1, Icon: GlobeIcon, glow: 'from-gold-400/25' },
  { n: 2, Icon: OpenBookIcon, glow: 'from-sky-400/20' },
  { n: 3, Icon: GraduationCapIcon, glow: 'from-gold-400/25' },
  { n: 4, Icon: MediaPlayIcon, glow: 'from-sky-400/20' },
  { n: 5, Icon: UsersIcon, glow: 'from-gold-400/25' },
  { n: 6, Icon: ChatHeartIcon, glow: 'from-sky-400/20' },
  { n: 7, Icon: ChartIcon, glow: 'from-gold-400/25' },
  { n: 8, Icon: CompassIcon, glow: 'from-sky-400/20' },
  { n: 9, Icon: HeartHandsIcon, glow: 'from-gold-400/25' },
  { n: 10, Icon: SproutIcon, glow: 'from-sky-400/20' },
  { n: 11, Icon: UsersIcon, glow: 'from-gold-400/25' },
  { n: 12, Icon: GlobeIcon, glow: 'from-gold-400/30' },
];
const COUNT = SLIDES.length;

/**
 * The slides that have a real photograph. A photograph for slide N is a file at /site/discover/slide-N.jpg (portrait or landscape,
 * about 1600 px wide); add its number here and it appears behind that slide. Until then a slide shows the brand navy and gold with
 * its symbol, so nothing is ever a broken picture.
 */
const PHOTOS: number[] = [];
const photoOf = (n: number) => (PHOTOS.includes(n) ? `/site/discover/slide-${n}.jpg` : null);

// "Discover The God Nation": twelve slides, one under the other, each showing a different side of the movement (training, leadership
// academy, digital evangelism, community, prayer, skills, representation, mutual support, discipleship, unity) and ending with the
// invitation to join. Same logo, colours and type on every slide; the headline is big enough to read on a phone.
export function DiscoverSlides() {
  const { t } = useTranslation();

  return (
    <ol className="mt-10 space-y-5 sm:space-y-7" data-testid="discover-slides" aria-label={t('discover.aria')}>
      {SLIDES.map(({ n, Icon, glow }) => {
        const photo = photoOf(n);
        const last = n === COUNT;
        const tag = t(`discover.s${n}_tag`, { defaultValue: '' });
        return (
          <li key={n}>
            <article
              className="relative isolate flex min-h-[30rem] flex-col justify-between overflow-hidden rounded-3xl bg-gradient-to-br from-brand-950 via-brand-900 to-brand-800 p-5 text-white shadow-xl shadow-brand-950/20 sm:min-h-[34rem] sm:p-9"
              data-testid={`discover-slide-${n}`}
            >
              {photo ? (
                <>
                  <img src={photo} alt="" loading="lazy" className="absolute inset-0 -z-20 h-full w-full object-cover" />
                  <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-t from-brand-950 via-brand-950/70 to-brand-950/10" />
                </>
              ) : (
                <>
                  <div aria-hidden className={`absolute -right-20 -top-20 -z-10 h-80 w-80 rounded-full bg-gradient-to-br ${glow} to-transparent blur-3xl`} />
                  <Icon className="absolute -bottom-6 -right-6 -z-10 h-64 w-64 text-white/[0.06] sm:h-80 sm:w-80" />
                </>
              )}

              <header className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2">
                  <img src="/icons/icon-192.png" alt="" className="h-9 w-9 rounded-lg bg-white object-contain p-0.5" />
                  <span className="text-xs font-bold uppercase tracking-widest text-gold-400">The God Nation</span>
                </span>
                <span className="text-xs font-semibold tabular-nums text-white/70">
                  {String(n).padStart(2, '0')} / {COUNT}
                </span>
              </header>

              <div className="mt-16">
                <p className="text-xs font-bold uppercase tracking-widest text-gold-400">{t(`discover.s${n}_label`)}</p>
                <h3 className="mt-3 text-3xl font-extrabold leading-tight tracking-tight sm:text-5xl">{t(`discover.s${n}_title`)}</h3>
                <p className="mt-4 max-w-xl text-base text-brand-100 sm:text-lg">{t(`discover.s${n}_body`)}</p>
                {tag && <p className={`mt-4 font-bold text-gold-400 ${last ? 'text-sm uppercase tracking-widest sm:text-base' : 'text-lg'}`}>{tag}</p>}
                {last && (
                  <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                    <Link to="/member/join" className="inline-flex items-center justify-center rounded-lg bg-gold-500 px-6 py-3 font-bold text-brand-950 shadow-lg shadow-black/10 hover:bg-gold-400">
                      {t('homePage.join')} <span aria-hidden className="ml-2">→</span>
                    </Link>
                    <Link to="/member/login" className="inline-flex items-center justify-center rounded-lg border border-white/60 px-6 py-3 font-semibold text-white hover:bg-white/10">
                      {t('homePage.sign_in')}
                    </Link>
                  </div>
                )}
              </div>
            </article>
          </li>
        );
      })}
    </ol>
  );
}
