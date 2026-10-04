/** Path the app uses to show someone's picture, or null when they have none.
 * The ?v= part changes whenever the picture changes, so browsers never keep
 * showing an old cached picture. */
export function profilePhotoPath(person: { id: string; photoStorageKey: string | null; photoUpdatedAt: Date | null }): string | null {
  if (!person.photoStorageKey) return null;
  const version = person.photoUpdatedAt ? person.photoUpdatedAt.getTime() : 0;
  return `/api/people/${person.id}/photo?v=${version}`;
}
