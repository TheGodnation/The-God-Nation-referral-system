import { useState, type ReactNode } from 'react';

// A person as a tall card (about 112 x 140): their picture filling the card,
// cropped from the top so faces stay in view, with the name along the bottom.
// Someone with no picture gets a coloured card with their initials, so
// everyone is shown alike. Used on the Home strip and in the Leadership
// Directory.

const TINTS = [
  'from-brand-700 to-brand-500',
  'from-emerald-700 to-emerald-500',
  'from-sky-700 to-sky-500',
  'from-violet-700 to-violet-500',
  'from-amber-600 to-amber-400',
  'from-rose-700 to-rose-500',
  'from-teal-700 to-teal-500',
];

function tintOf(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return TINTS[h % TINTS.length];
}

function initialsOf(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join('') || '?'
  );
}

export function PortraitCard({
  name,
  photoUrl,
  caption,
  onClick,
  className = 'w-28',
}: {
  name: string;
  photoUrl?: string | null;
  /** A second line under the name (a position or place). */
  caption?: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const showPhoto = Boolean(photoUrl) && !failed;
  const body = (
    <>
      {showPhoto ? (
        <img src={photoUrl!} alt="" loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover object-top" />
      ) : (
        <span aria-hidden className={`flex h-full w-full items-center justify-center bg-gradient-to-br ${tintOf(name)} text-3xl font-semibold text-white/95`}>
          {initialsOf(name)}
        </span>
      )}
      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/40 to-transparent px-2 pb-1.5 pt-6 text-left">
        <span className="block truncate text-xs font-semibold text-white">{name}</span>
        {caption && <span className="block truncate text-[11px] text-white/80">{caption}</span>}
      </span>
    </>
  );
  const frame = `relative block aspect-[4/5] shrink-0 overflow-hidden rounded-xl bg-slate-200 shadow-sm ${className}`;
  return onClick ? (
    <button type="button" onClick={onClick} aria-label={name} className={`${frame} focus:outline-none focus:ring-2 focus:ring-brand-400`}>
      {body}
    </button>
  ) : (
    <div className={frame} role="img" aria-label={name}>
      {body}
    </div>
  );
}
