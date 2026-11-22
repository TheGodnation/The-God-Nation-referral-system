// Times for "Send later". The phone's date-time box works in the phone's own time; the app shows (and the teaching posts at) an exact
// moment, and always says it in Cameroon time as well, so there is no doubt about when it will go out.

const pad = (n: number) => String(n).padStart(2, '0');

/** The value for a date-time box (phone's own time) from an exact moment. */
export function toLocalInput(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The exact moment (ISO) for what was typed in a date-time box, or null when it is empty or not a date. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** "Wednesday 25 November, 07:00" in Cameroon time. */
export function cameroonLabel(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale.startsWith('fr') ? 'fr-FR' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Douala' }).format(new Date(iso));
}
