import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '../Avatar';

// The top of a profile wall, Facebook-style: a wide cover picture, a big
// round profile picture overlapping it, the name and a short line about
// the person. On your own wall, small camera buttons let you change the
// cover and the profile picture.
export function WallHeader({
  name,
  photoUrl,
  coverUrl,
  bio,
  subtitle,
  editable = false,
  busy = null,
  onPickCover,
  onPickPhoto,
  children,
}: {
  name: string;
  photoUrl?: string | null;
  coverUrl?: string | null;
  bio?: string | null;
  subtitle?: string | null;
  editable?: boolean;
  busy?: 'cover' | 'photo' | null;
  onPickCover?: (file: File) => void;
  onPickPhoto?: (file: File) => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const coverInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const [coverFailed, setCoverFailed] = useState(false);

  const showCover = coverUrl && !coverFailed;

  return (
    <div className="overflow-hidden rounded-b-2xl bg-white shadow-sm sm:rounded-2xl">
      <div className="relative h-44 w-full bg-gradient-to-br from-brand-700 via-brand-500 to-amber-400 sm:h-56">
        {showCover && (
          <img
            src={coverUrl!}
            alt={t('wall.cover_alt', { name }) ?? ''}
            className="h-full w-full object-cover"
            onError={() => setCoverFailed(true)}
          />
        )}
        {editable && (
          <>
            <button
              type="button"
              onClick={() => coverInput.current?.click()}
              disabled={busy !== null}
              className="absolute bottom-3 right-3 rounded-full bg-black/55 px-3 py-1.5 text-sm font-medium text-white backdrop-blur"
            >
              {busy === 'cover' ? t('wall.uploading') : `📷 ${coverUrl ? t('wall.change_cover') : t('wall.add_cover')}`}
            </button>
            <input
              ref={coverInput}
              type="file"
              accept="image/*"
              className="hidden"
              data-testid="cover-input"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) onPickCover?.(f);
              }}
            />
          </>
        )}
      </div>

      <div className="px-4 pb-4">
        <div className="-mt-14 flex items-end justify-between gap-3">
          <div className="relative">
            <span className="block rounded-full bg-white p-1 shadow">
              <Avatar name={name} photoUrl={photoUrl} size={112} />
            </span>
            {editable && (
              <>
                <button
                  type="button"
                  onClick={() => photoInput.current?.click()}
                  disabled={busy !== null}
                  aria-label={(photoUrl ? t('wall.change_photo') : t('wall.add_photo')) ?? ''}
                  className="absolute bottom-1 right-1 flex h-9 w-9 items-center justify-center rounded-full border-2 border-white bg-slate-200 text-base shadow"
                >
                  {busy === 'photo' ? '…' : '📷'}
                </button>
                <input
                  ref={photoInput}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  data-testid="photo-input"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) onPickPhoto?.(f);
                  }}
                />
              </>
            )}
          </div>
        </div>

        <h1 className="mt-2 text-2xl font-bold text-slate-900">{name}</h1>
        {bio && <p className="mt-1 whitespace-pre-wrap text-[15px] text-slate-700">{bio}</p>}
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
        {children && <div className="mt-3">{children}</div>}
      </div>
    </div>
  );
}
