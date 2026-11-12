import { useTranslation } from 'react-i18next';

// The central admin's three ways to delete a person: free to register again,
// only with the admin's approval, or never. A note is asked for the last two.

export type DeletionMode = 'FREE' | 'APPROVAL' | 'NEVER';

const MODES: DeletionMode[] = ['FREE', 'APPROVAL', 'NEVER'];

export function DeleteChoice({
  mode,
  note,
  onMode,
  onNote,
  name,
}: {
  mode: DeletionMode;
  note: string;
  onMode: (m: DeletionMode) => void;
  onNote: (n: string) => void;
  name?: string;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="space-y-2 rounded-lg border border-slate-200 p-3 text-sm" data-testid="delete-choice">
      <legend className="px-1 text-xs font-semibold text-slate-700">{t('deleteChoice.legend', { name: name ?? '' })}</legend>
      {MODES.map((m) => (
        <label key={m} className="flex cursor-pointer items-start gap-2">
          <input type="radio" name="deletion-mode" className="mt-1 h-4 w-4" checked={mode === m} onChange={() => onMode(m)} data-testid={`delete-mode-${m}`} />
          <span>
            <span className="block font-medium text-slate-800">{t(`deleteChoice.${m}_title`)}</span>
            <span className="block text-xs text-slate-600">{t(`deleteChoice.${m}_help`)}</span>
          </span>
        </label>
      ))}
      {mode !== 'FREE' && (
        <label className="block">
          <span className="block text-xs font-medium text-slate-700">{t('deleteChoice.note_label')}</span>
          <textarea
            className="input mt-1 w-full text-sm"
            rows={2}
            maxLength={500}
            value={note}
            onChange={(e) => onNote(e.target.value)}
            placeholder={t('deleteChoice.note_placeholder') ?? ''}
            data-testid="delete-note"
          />
          <span className="block text-xs text-slate-500">{t('deleteChoice.kept_note')}</span>
        </label>
      )}
    </fieldset>
  );
}
