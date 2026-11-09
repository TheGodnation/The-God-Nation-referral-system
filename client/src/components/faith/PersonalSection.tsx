import { useTranslation } from 'react-i18next';

// "My personal response": the last part of the Book 1 and Book 2 exams. Never
// marked, never changes pass or fail, but every question must be answered
// before the exam can be finished. Other members never see the answers.

export interface PersonalQuestion {
  id: string;
  kind: 'CHOICE' | 'TEXT';
  textEn: string;
  textFr: string | null;
  bodyEn: string | null;
  bodyFr: string | null;
  required: boolean;
  options: { id: string; textEn: string; textFr: string | null }[];
}

export type PersonalAnswers = Record<string, { optionId?: string; text?: string }>;

export function missingPersonal(questions: PersonalQuestion[], answers: PersonalAnswers): string[] {
  return questions
    .filter((q) => q.required && !(q.kind === 'CHOICE' ? answers[q.id]?.optionId : answers[q.id]?.text?.trim()))
    .map((q) => q.id);
}

export function PersonalSection({ questions, answers, onChange, showMissing }: { questions: PersonalQuestion[]; answers: PersonalAnswers; onChange: (next: PersonalAnswers) => void; showMissing: boolean }) {
  const { t, i18n } = useTranslation();
  const isFr = i18n.language.startsWith('fr');
  const pick = (en: string, fr: string | null) => (isFr ? fr || en : en);
  const missing = new Set(showMissing ? missingPersonal(questions, answers) : []);

  return (
    <section className="space-y-4 rounded-xl border border-brand-200 bg-brand-50/40 p-4" data-testid="personal-section">
      <div>
        <h2 className="text-lg font-bold text-brand-900">{t('examPersonal.title')}</h2>
        <p className="mt-1 text-sm text-slate-700">{t('examPersonal.intro')}</p>
      </div>
      {questions.map((q, i) => (
        <fieldset key={q.id} className={`space-y-2 rounded-lg ${missing.has(q.id) ? 'border border-red-300 bg-red-50 p-2' : ''}`}>
          <legend className="mb-1 font-medium text-slate-800">
            {i + 1}. {pick(q.textEn, q.textFr)}
          </legend>
          {q.bodyEn && <p className="whitespace-pre-wrap rounded-lg border-l-4 border-brand-300 bg-white px-3 py-2 text-sm italic text-slate-700">{pick(q.bodyEn, q.bodyFr)}</p>}
          {q.kind === 'CHOICE' ? (
            q.options.map((o) => (
              <label key={o.id} className="flex items-start gap-2 text-sm">
                <input type="radio" className="mt-1" name={`personal-${q.id}`} checked={answers[q.id]?.optionId === o.id} onChange={() => onChange({ ...answers, [q.id]: { optionId: o.id } })} />
                <span>{pick(o.textEn, o.textFr)}</span>
              </label>
            ))
          ) : (
            <textarea
              className="input"
              rows={3}
              maxLength={2000}
              value={answers[q.id]?.text ?? ''}
              onChange={(e) => onChange({ ...answers, [q.id]: { text: e.target.value } })}
              aria-label={pick(q.textEn, q.textFr)}
              placeholder={t('examPersonal.type_here') ?? ''}
            />
          )}
          {missing.has(q.id) && <p className="text-xs font-medium text-red-700">{t('examPersonal.answer_this')}</p>}
        </fieldset>
      ))}
    </section>
  );
}
