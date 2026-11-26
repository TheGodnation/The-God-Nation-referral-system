import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChartIcon, ChatHeartIcon, CompassIcon, GlobeIcon, GraduationCapIcon, HeartHandsIcon, MediaPlayIcon, UsersIcon } from './Icons';

type IconType = (p: { className?: string }) => JSX.Element;

// `n` names the slide's words (discover.s<n>_…); the slides are numbered on screen in the order below. Spiritual training (2) and
// Discipleship (10) are part of the Leadership Academy slide (3) now.
const SLIDES: { n: number; Icon: IconType }[] = [
  { n: 1, Icon: GlobeIcon },
  { n: 3, Icon: GraduationCapIcon },
  { n: 4, Icon: MediaPlayIcon },
  { n: 5, Icon: UsersIcon },
  { n: 6, Icon: ChatHeartIcon },
  { n: 7, Icon: ChartIcon },
  { n: 8, Icon: CompassIcon },
  { n: 9, Icon: HeartHandsIcon },
  { n: 11, Icon: UsersIcon },
  { n: 12, Icon: GlobeIcon },
];
const COUNT = SLIDES.length;

/**
 * The photograph behind each slide (a file under /site/, about 1600 px wide is plenty). A slide with no photograph yet shows a bright,
 * plain version (no picture, no dark card) so nothing is ever a broken picture.
 *  - `at`: which part of the picture stays in view when it is cropped to the slide.
 *  - `zoom`: enlarge the picture around that point (used to leave out something at the edge of the photo).
 * The founder's photographs, each on the slide whose words it shows (the last slide stays plain and bright).
 */
interface Photo {
  src: string;
  at?: string;
  zoom?: number;
}
const PHOTOS: Record<number, Photo> = {
  1: { src: '/site/revival-worship.jpg', at: '38% 45%' },
  // The Academy's own banner ("The God Nation Media & Leadership Academy — Learn · Grow · Lead") with students at work.
  3: { src: '/site/skills-learning.jpg', at: '72% 40%' },
  4: { src: '/site/digital-online.jpg', at: '30% 50%' },
  5: { src: '/site/session-close.jpg', at: '50% 40%' },
  6: { src: '/site/prayer-group.jpg', at: '45% 55%' },
  7: { src: '/site/session-room.jpg', at: '45% 85%', zoom: 1.45 },
  8: { src: '/site/national-network.jpg', at: '55% 40%' },
  9: { src: '/site/mutual-support.jpg', at: '48% 50%' },
  11: { src: '/site/unity-friends.jpg', at: '45% 40%' },
};

const SHADOW = '[text-shadow:0_1px_3px_rgba(0,0,0,0.55),0_2px_18px_rgba(0,0,0,0.45)]';

// "Discover The God Nation": ten slides, one under the other, each showing a different side of the movement (the leadership academy
// with its training, digital evangelism, community, prayer, skills, representation, mutual support, unity) and ending with the
// invitation to join. A slide is its photograph, edge to edge and bright, with the headline written straight on it in white (only the
// lower part of the picture is darkened a little, so the words stay readable and the top of the photo stays bright). Same logo and
// type on every slide; the headline is big enough to read on a phone.
export function DiscoverSlides() {
  const { t } = useTranslation();

  return (
    <>
      <h2 className="sr-only">{t('discover.heading')}</h2>
      <ol className="-mx-4 space-y-1 sm:mx-0 sm:space-y-4" data-testid="discover-slides" aria-label={t('discover.aria')}>
        {SLIDES.map(({ n, Icon }, index) => {
          const photo = PHOTOS[n];
          const last = index === COUNT - 1;
          const tag = t(`discover.s${n}_tag`, { defaultValue: '' });
          // Slides 1 and 12 have no topic tag: their headline says it all ("A Kingdom revival movement is emerging!", "You have a place…").
          const label = t(`discover.s${n}_label`, { defaultValue: '' });
          const onPhoto = Boolean(photo);
          return (
            <li key={n}>
              <article
                className={`relative isolate flex min-h-[32rem] flex-col justify-between overflow-hidden p-5 sm:min-h-[34rem] sm:rounded-3xl sm:p-9 ${
                  onPhoto ? 'text-white' : 'bg-gradient-to-br from-white via-brand-50 to-brand-100 text-brand-950'
                }`}
                data-testid={`discover-slide-${n}`}
              >
                {photo ? (
                  <>
                    <img
                      src={photo.src}
                      alt=""
                      loading="lazy"
                      className="absolute inset-0 -z-20 h-full w-full object-cover saturate-110"
                      style={{ objectPosition: photo.at, ...(photo.zoom ? { transform: `scale(${photo.zoom})`, transformOrigin: photo.at } : {}) }}
                    />
                    {/* Only the lower part is darkened, for the words; the rest of the photograph stays as bright as it was taken. */}
                    <div aria-hidden className="absolute inset-x-0 bottom-0 -z-10 h-[78%] bg-gradient-to-t from-black/90 via-black/60 to-transparent" />
                  </>
                ) : (
                  <Icon className="absolute -bottom-8 -right-8 -z-10 h-72 w-72 text-brand-200/60 sm:h-96 sm:w-96" />
                )}

                <header className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 rounded-full bg-white/90 py-1 pl-1 pr-3 shadow-sm">
                    <img src="/icons/icon-192.png" alt="" className="h-7 w-7 rounded-full object-contain" />
                    <span className="text-[11px] font-bold uppercase tracking-widest text-brand-900">The God Nation</span>
                  </span>
                </header>

                <div className="mt-16">
                  {label && <p className={`mb-3 inline-block rounded-full px-3 py-1 text-xs font-bold uppercase tracking-widest ${onPhoto ? 'bg-gold-400 text-brand-950' : 'bg-brand-600 text-white'}`}>{label}</p>}
                  <h3 className={`text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl ${onPhoto ? SHADOW : 'text-brand-900'}`}>{t(`discover.s${n}_title`)}</h3>
                  <p className={`mt-4 max-w-xl text-base sm:text-lg ${onPhoto ? `text-white ${SHADOW}` : 'text-slate-700'}`}>{t(`discover.s${n}_body`)}</p>
                  {tag && (
                    <p className={`mt-4 font-bold ${last ? 'text-sm uppercase tracking-widest sm:text-base' : 'text-lg'} ${onPhoto ? `text-gold-400 ${SHADOW}` : 'text-brand-700'}`}>{tag}</p>
                  )}
                  {last && (
                    <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                      <Link to="/member/join" className="inline-flex items-center justify-center rounded-lg bg-gold-500 px-6 py-3 font-bold text-brand-950 shadow-lg shadow-black/10 hover:bg-gold-400">
                        {t('homePage.join')} <span aria-hidden className="ml-2">→</span>
                      </Link>
                      <Link
                        to="/member/login"
                        className={`inline-flex items-center justify-center rounded-lg border px-6 py-3 font-semibold ${
                          onPhoto ? 'border-white/80 bg-white/90 text-brand-900 hover:bg-white' : 'border-brand-700 text-brand-800 hover:bg-brand-50'
                        }`}
                      >
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
