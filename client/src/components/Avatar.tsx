import { useState } from 'react';

// A person's round profile picture, or their initials when they have no
// picture (or it fails to load). Used everywhere a person's name appears.
export function Avatar({ name, photoUrl, size = 40 }: { name: string; photoUrl?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join('') || '?';

  const style = { width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.38)) };

  if (photoUrl && !failed) {
    return (
      <img
        src={photoUrl}
        alt={name}
        style={style}
        className="shrink-0 rounded-full object-cover"
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span
      role="img"
      aria-label={name}
      style={style}
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-800"
    >
      {initials}
    </span>
  );
}
