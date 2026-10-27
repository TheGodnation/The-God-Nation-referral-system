import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';

export interface EventItem {
  id: string;
  communityId: string;
  communityName: string;
  title: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
  onlineUrl: string | null;
  cancelled: boolean;
  hasReplay: boolean;
  going: boolean;
  goingCount: number;
  presence: 'LIVE' | 'REPLAY' | null;
}

/** "Sun 3 Nov, 10:00" in the member's language. */
export function formatWhen(iso: string, lang: string) {
  return new Date(iso).toLocaleString(lang.startsWith('fr') ? 'fr-FR' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// <input type="datetime-local"> wants local "YYYY-MM-DDTHH:mm".
function toLocalInput(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export interface EventFormValues {
  id?: string;
  communityId: string;
  title: string;
  description: string | null;
  startsAt: string | null;
  endsAt: string | null;
  location: string | null;
  onlineUrl: string | null;
  replayTeachingId: string | null;
}

/** Adding a new event, or changing one (the assembly cannot be changed afterwards). */
export function EventForm({
  initial,
  assemblies,
  onSaved,
  onClose,
}: {
  initial?: EventFormValues;
  assemblies: { id: string; name: string }[];
  onSaved: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const editing = Boolean(initial?.id);
  const [communityId, setCommunityId] = useState(initial?.communityId ?? assemblies[0]?.id ?? '');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [startsAt, setStartsAt] = useState(toLocalInput(initial?.startsAt));
  const [endsAt, setEndsAt] = useState(toLocalInput(initial?.endsAt));
  const [location, setLocation] = useState(initial?.location ?? '');
  const [onlineUrl, setOnlineUrl] = useState(initial?.onlineUrl ?? '');
  const [replayTeachingId, setReplayTeachingId] = useState(initial?.replayTeachingId ?? '');
  const [teachings, setTeachings] = useState<{ id: string; title: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!communityId) return;
    let alive = true;
    api
      .get<{ items: { id: string; title: string }[] }>(`/api/events/replay-options?communityId=${encodeURIComponent(communityId)}`)
      .then((r) => alive && setTeachings(r.items))
      .catch(() => alive && setTeachings([]));
    return () => {
      alive = false;
    };
  }, [communityId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body = {
      title,
      description,
      startsAt: startsAt ? new Date(startsAt).toISOString() : undefined,
      ...(endsAt ? { endsAt: new Date(endsAt).toISOString() } : {}),
      location,
      onlineUrl,
      replayTeachingId: replayTeachingId || null,
    };
    try {
      if (editing && initial?.id) {
        await api.patch(`/api/events/${initial.id}`, body);
        onSaved(initial.id);
      } else {
        const r = await api.post<{ id: string }>('/api/events', { ...body, communityId });
        onSaved(r.id);
      }
    } catch (err) {
      setError(err instanceof ApiError && err.message ? err.message : t('events.save_failed'));
      setSaving(false);
    }
  }

  const field = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2';
  return (
    <form onSubmit={submit} className="card space-y-3">
      <h2 className="text-lg font-semibold text-brand-900">{editing ? t('events.edit_title') : t('events.new_title')}</h2>
      {!editing && (
        <label className="block text-sm font-medium text-slate-700">
          {t('events.f_assembly')}
          <select className={field} value={communityId} onChange={(e) => setCommunityId(e.target.value)}>
            {assemblies.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block text-sm font-medium text-slate-700">
        {t('events.f_title')}
        <input className={field} value={title} maxLength={200} required onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        {t('events.f_description')}
        <textarea className={field} rows={3} value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium text-slate-700">
          {t('events.f_start')}
          <input type="datetime-local" className={field} value={startsAt} required onChange={(e) => setStartsAt(e.target.value)} />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          {t('events.f_end')}
          <input type="datetime-local" className={field} value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
        </label>
      </div>
      <label className="block text-sm font-medium text-slate-700">
        {t('events.f_place')}
        <input className={field} value={location} maxLength={200} onChange={(e) => setLocation(e.target.value)} />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        {t('events.f_online')}
        <input className={field} value={onlineUrl} maxLength={500} inputMode="url" placeholder="https://" onChange={(e) => setOnlineUrl(e.target.value)} />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        {t('events.f_replay')}
        <select className={field} value={replayTeachingId} onChange={(e) => setReplayTeachingId(e.target.value)}>
          <option value="">{t('events.f_replay_none')}</option>
          {teachings.map((x) => (
            <option key={x.id} value={x.id}>
              {x.title}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs font-normal text-slate-500">{t('events.f_replay_help')}</span>
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? t('events.saving') : editing ? t('events.save') : t('events.create')}
        </button>
        <button type="button" onClick={onClose} className="btn-secondary">
          {t('events.cancel_form')}
        </button>
      </div>
    </form>
  );
}
