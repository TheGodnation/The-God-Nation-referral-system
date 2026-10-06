/** Path the app uses to show someone's picture, or null when they have none.
 * The ?v= part changes whenever the picture changes, so browsers never keep
 * showing an old cached picture. */
export function profilePhotoPath(person: { id: string; photoStorageKey: string | null; photoUpdatedAt: Date | null }): string | null {
  if (!person.photoStorageKey) return null;
  const version = person.photoUpdatedAt ? person.photoUpdatedAt.getTime() : 0;
  return `/api/people/${person.id}/photo?v=${version}`;
}

/** Path of a group's picture, or null when it has none. */
export function groupPhotoPath(c: { id: string; photoStorageKey: string | null; photoUpdatedAt: Date | null }): string | null {
  if (!c.photoStorageKey) return null;
  return `/api/group-photos/${c.id}?v=${c.photoUpdatedAt ? c.photoUpdatedAt.getTime() : 0}`;
}

/** Path of the Updates banner picture, or null when there is none. */
export function appBannerPath(s: { appBannerStorageKey: string | null; appBannerUpdatedAt: Date | null } | null): string | null {
  if (!s?.appBannerStorageKey) return null;
  return `/api/app-banner?v=${s.appBannerUpdatedAt ? s.appBannerUpdatedAt.getTime() : 0}`;
}

/** Path of someone's cover (wall) picture, or null when they have none. */
export function coverPhotoPath(person: { id: string; coverStorageKey: string | null; coverUpdatedAt: Date | null }): string | null {
  if (!person.coverStorageKey) return null;
  const version = person.coverUpdatedAt ? person.coverUpdatedAt.getTime() : 0;
  return `/api/people/${person.id}/cover?v=${version}`;
}
