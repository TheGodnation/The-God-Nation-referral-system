import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { LeadershipCollaboration } from '../LeadershipCollaboration';

interface Room {
  generation: number;
  leaders: number;
  unreadCount: number;
  lastMessageAt: string | null;
}

// The National Coordinator in the leaders' rooms: "All leaders" and one room for each generation of the assembly tree.
// Pick a room, read it, and write to every leader of that level at once. Offered in the admin dashboard and in the
// central admin's member profile (base says which set of routes to use).
export function LeaderRoomsPanel({ base }: { base: string }) {
  const { t, i18n } = useTranslation();
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [canWrite, setCanWrite] = useState(true);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    api
      .get<{ items: Room[]; canWrite: boolean }>(`${base}/`)
      .then((r) => {
        setRooms(r.items);
        setCanWrite(r.canWrite);
      })
      .catch(() => setRooms([]));
  }, [base]);

  const label = (g: number) => (g === -1 ? t('leadershipCollaboration.all_title') : g === 0 ? t('instructions.hq') : t('instructions.generation', { n: g }));

  return (
    <div className="space-y-4" data-testid="leader-rooms-panel">
      <div>
        <h2 className="text-lg font-bold text-brand-900">{t('leaderRooms.title')}</h2>
        <p className="text-sm text-slate-600">{t('leaderRooms.help')}</p>
        {!canWrite && <p className="mt-1 text-sm text-amber-800">{t('leaderRooms.need_profile')}</p>}
      </div>
      {rooms === null && <p className="text-sm text-slate-500">{t('instructions.loading')}</p>}
      {rooms && rooms.length === 0 && <p className="card text-sm text-slate-600">{t('leaderRooms.none')}</p>}
      <ul className="grid grid-cols-2 gap-2">
        {(rooms ?? []).map((r) => (
          <li key={r.generation}>
            <button
              type="button"
              onClick={() => setOpen(open === r.generation ? null : r.generation)}
              className={`block w-full rounded-xl border p-3 text-left ${open === r.generation ? 'border-brand-700 bg-brand-50' : 'border-slate-200 bg-white'}`}
              data-testid={`room-${r.generation}`}
            >
              <span className="flex items-center justify-between gap-1 text-sm font-bold text-brand-900">
                {label(r.generation)}
                {r.unreadCount > 0 && <span className="rounded-full bg-brand-600 px-2 py-0.5 text-xs text-white">{r.unreadCount}</span>}
              </span>
              <span className="block text-xs text-slate-500">{t('leaderRooms.leaders', { count: r.leaders })}</span>
              {r.lastMessageAt && <span className="block text-[11px] text-slate-400">{new Date(r.lastMessageAt).toLocaleDateString(i18n.language)}</span>}
            </button>
          </li>
        ))}
      </ul>
      {open !== null && <LeadershipCollaboration key={open} generation={open} base={base} />}
    </div>
  );
}
