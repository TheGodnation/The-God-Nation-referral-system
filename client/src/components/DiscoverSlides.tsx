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
 * The photographs behind the slides. Where a slide has none, it shows the brand navy and gold with its symbol, so nothing is ever a
 * broken picture. A photograph for slide N goes in here with its file under /site/ (about 1600 px wide is plenty):
 *  - 'background': fills the whole slide, under a dark navy fade so the words stay readable (`at` = which part of the picture stays in view).
 *  - 'book': a book cover standing on the slide (it is a picture of a book, so it is shown whole rather than cropped).
 * The pictures here are the ones already used on the public site, placed where they fit the topic until the final photographs come.
 */
interface Photo {
  mode: 'background' | 'book';
  src: string;
  /** French version of the picture, when it differs (book covers). */
  frSrc?: string;
  at?: string;
}
const PHOTOS: Record<number, Photo> = {
  2: { mode: 'book', src: '/site/book1-en.webp', frSrc: '/site/book1-fr.webp' },
  3: { mode: 'background', src: '/site/session-room.jpg', at: '30% 50%' },
  5: { mode: 'background', src: '/site/session-close.jpg', at: '50% 40%' },
  10: { mode: 'background', src: '/site/session-presenter.jpg', at: '45% 50%' },
};

// "Discover The God Nation": twelve slides, one under the other, each showing a different side of the movement (training, leadership
// academy, digital evangelism, community, prayer, skills, representation, mutual support, discipleship, unity) and ending with the
// invitation to join. Same logo, colours and type on every slide; the headline is big enough to read on a phone.
export function DiscoverSlides() {
  const { t, i18n } = useTranslation();
  const french = i18n.language.startsWith('fr');

  return (
    <>
    <h2 className="sr-only">{t('discover.heading')}</h2>
    <ol className="space-y-5 sm:space-y-7" data-testid="discover-slides" aria-label={t('discover.aria')}>
      {SLIDES.map(({ n, Icon, glow }) => {
        const photo = PHOTOS[n];
        const photoSrc = photo ? (french && photo.frSrc ? photo.frSrc : photo.src) : null;
        const last = n === COUNT;
        const tag = t(`discover.s${n}_tag`, { defaultValue: '' });
        return (
          <li key={n}>
            <article
              className="relative isolate flex min-h-[30rem] flex-col justify-between overflow-hidden rounded-3xl bg-gradient-to-br from-brand-950 via-brand-900 to-brand-800 p-5 text-white shadow-xl shadow-brand-950/20 sm:min-h-[34rem] sm:p-9"
              data-testid={`discover-slide-${n}`}
            >
              {photo?.mode === 'background' && photoSrc ? (
                <>
                  <img src={photoSrc} alt="" loading="lazy" className="absolute inset-0 -z-20 h-full w-full object-cover" style={{ objectPosition: photo.at }} />
                  <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-t from-brand-950 via-brand-950/70 to-brand-950/10" />
                  <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-28 bg-gradient-to-b from-brand-950/90 to-transparent" />
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

              {photo?.mode === 'book' && photoSrc && (
                <div className="my-6 flex justify-end sm:my-2">
                  <img src={photoSrc} alt="" loading="lazy" width={520} height={780} className="h-auto w-28 rotate-3 rounded-md shadow-2xl shadow-black/50 ring-1 ring-white/20 sm:w-44" data-testid="discover-book" />
                </div>
              )}

              <div className={photo?.mode === 'book' ? '' : 'mt-16'}>
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
    </>
  );
}
