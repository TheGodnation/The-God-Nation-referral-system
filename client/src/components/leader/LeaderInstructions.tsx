import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { pickText } from '../../lib/instructionText';

type Status = 'DONE' | 'LATE' | 'SEEN' | 'WAITING';
export interface MyInstruction {
  id: string;
  sender?: 'NATIONAL_COORDINATOR' | 'REPRESENTATIVE';
  title: string;
  body: string;
  language: 'en' | 'fr' | null;
  titleTr: string | null;
  bodyTr: string | null;
  dueAt: string | null;
  createdAt: string;
  status: Status;
  seenAt: string | null;
  doneAt: string | null;
  note: string | null;
  replies: { name: string; note: string | null; doneAt: string | null }[];
}

// What the National Coordinator asked of this leader: read it (it is marked Seen when opened), do it, and mark it
// Done with an optional note. Unfinished ones come first.
export function LeaderInstructions({ onChanged }: { onChanged?: () => void }) {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<MyInstruction[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api.get<{ items: MyInstruction[] }>('/api/member/instructions/').then((r) => setItems(r.items)).catch(() => setItems([]));
  useEffect(() => { void load(); }, []);

  async function open(i: MyInstruction) {
    const next = openId === i.id ? null : i.id;
    setOpenId(next);
    setNote(i.note ?? '');
    if (next && !i.seenAt) {
      await api.post(`/api/member/instructions/${i.id}/seen`, {}).catch(() => {});
      await load();
      onChanged?.();
    }
  }

  async function done(i: MyInstruction) {
    setBusy(true);
    try {
      await api.post(`/api/member/instructions/${i.id}/done`, { note: note.trim() || null });
      setOpenId(null);
      await load();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  }

  if (items === null) return <p className="text-sm text-slate-500">{t('instructions.loading')}</p>;
  if (items.length === 0) return <p className="card text-sm text-slate-600" data-testid="leader-instructions-none">{t('instructions.leader_none')}</p>;
  const sorted = [...items].sort((a, b) => Number(a.status === 'DONE') - Number(b.status === 'DONE'));
  return (
    <ul className="space-y-2" data-testid="leader-instructions">
      {sorted.map((i) => (
        <li key={i.id} className={`card space-y-2 ${i.status === 'DONE' ? 'opacity-70' : ''}`}>
          <button type="button" className="block w-full text-left" onClick={() => void open(i)} data-testid={`leader-instruction-${i.id}`}>
            <span className="flex items-start justify-between gap-2">
              <span className="font-semibold text-brand-900">{pickText(i18n.language, i.language, i.title, i.titleTr)}</span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${i.status === 'DONE' ? 'bg-green-100 text-green-800' : i.status === 'LATE' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-900'}`}>
                {i.status === 'DONE' ? t('instructions.status_DONE') : i.status === 'LATE' ? t('instructions.status_LATE') : t('instructions.leader_todo')}
              </span>
            </span>
            <span className="block text-xs text-slate-500">
              {i.sender === 'REPRESENTATIVE' ? t('instructions.from_rep') : t('instructions.from_nc')} · {new Date(i.createdAt).toLocaleDateString(i18n.language)}
              {i.dueAt ? ` · ${t('instructions.due')} ${new Date(i.dueAt).toLocaleDateString(i18n.language)}` : ''}
            </span>
          </button>
          {openId === i.id && (
            <div className="space-y-3 border-t border-slate-200 pt-3">
              <p className="whitespace-pre-wrap text-sm text-slate-800">{pickText(i18n.language, i.language, i.body, i.bodyTr)}</p>
              {i.replies.length > 0 && (
                <div className="rounded-lg bg-slate-50 p-2 text-xs text-slate-700">
                  <p className="mb-1 font-semibold">{t('instructions.others_notes')}</p>
                  {i.replies.map((r, k) => <p key={k}><strong>{r.name}:</strong> {r.note}</p>)}
                </div>
              )}
              {i.status !== 'DONE' ? (
                <>
                  <textarea className="input min-h-[4rem]" placeholder={t('instructions.note_placeholder') ?? ''} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
                  <button type="button" className="btn-primary" disabled={busy} onClick={() => void done(i)} data-testid="instruction-done">
                    ✓ {t('instructions.mark_done')}
                  </button>
                </>
              ) : (
                i.note && <p className="text-xs text-slate-600">{t('instructions.your_note')}: “{i.note}”</p>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
