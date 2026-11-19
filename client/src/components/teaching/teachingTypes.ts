export interface TopicText {
  topic: string;
  bookTitle: string;
  chapter: string;
  teachingOn: string;
  help: string;
  meaning: string;
  startLabel: string;
  start: string;
  ifNotLabel: string;
  ifNot: string;
  dominion: string;
  verses: string[];
}

export interface Guide {
  title: string;
  definition: string;
  steps: { title: string; minutes: number; text: string }[];
  note?: string;
}

export interface TeachingWeek {
  weekStart: string;
  isCurrent: boolean;
  startsAt: string;
  endsAt: string;
  status: 'upcoming' | 'now' | 'done';
  kind: 'right' | 'key';
  text: TopicText;
  textLanguage: 'en' | 'fr';
  book: { id: string; canOpen: boolean } | null;
}

export interface TeachingView {
  enabled: boolean;
  isTeacher: boolean;
  language?: 'en' | 'fr';
  started?: boolean;
  startsOn?: string;
  minutes?: number;
  guide?: Guide | null;
  weeks?: TeachingWeek[];
}

/** The slot as people read it: "Monday 07:00" in Cameroon time (GMT+1), and in the phone's own time when that differs. */
export function slotLabel(iso: string, locale: string): { cameroon: string; local: string | null } {
  const d = new Date(iso);
  const fmt = (timeZone?: string) =>
    new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, ...(timeZone ? { timeZone } : {}) }).format(d);
  const cameroon = fmt('Africa/Douala');
  const local = fmt();
  return { cameroon, local: local === cameroon ? null : local };
}

export const dayName = (dayOfWeek: number, locale: string) => new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 10, 22 + dayOfWeek)));
