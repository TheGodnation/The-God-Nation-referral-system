import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { GraceBox } from './TrainingPayments';

// Shared by the Leadership School page, each book's page and the Learn page.

export const SCHOOL_BOOK_COUNT = 15;

export interface SchoolBook {
  id: string;
  trainingOrder: number;
  titleEn: string;
  titleFr: string | null;
  descriptionEn: string | null;
  descriptionFr: string | null;
  coverUrl?: string | null;
  pageCount?: number | null;
  chapterCount?: number;
  /** Where they stopped reading (null = not started). */
  lastPage?: number | null;
  unlocked: boolean;
  canRead: boolean;
  payment?: 'PAID' | 'CLAIMED' | 'PENDING' | null;
  lockedBecause?: 'NOT_STARTED' | 'PREVIOUS_EXAM' | 'PAYMENT' | null;
  exam: {
    id: string;
    passMark: number;
    bestPercentage: number | null;
    passed: boolean;
    tries?: number;
    canStart?: boolean;
    block?: 'PASSED' | 'NO_QUESTIONS' | 'NEEDS_RETAKE' | 'RETAKE_REQUESTED' | 'RETAKE_DECLINED' | 'NO_NEW_QUESTIONS' | null;
  } | null;
}

export interface SchoolSummary {
  enrollment: 'NONE' | 'REQUESTED' | 'ACTIVE' | 'REVOKED';
  books: SchoolBook[];
  price?: number;
  owed?: { books: number; amount: number };
  graceBooks?: number;
  maxGraceBooks?: number;
  graceRequest?: { status: 'REQUESTED' | 'GRANTED' | 'DECLINED'; books: number } | null;
  paymentInstructionsEn?: string | null;
  paymentInstructionsFr?: string | null;
  automaticPayments?: boolean;
}

export function useTr() {
  const { i18n } = useTranslation();
  const isFr = i18n.language.startsWith('fr');
  return (en: string, fr: string | null | undefined) => (isFr ? fr || en : en);
}

/** The book to carry on with: the first open book not yet passed or not yet paid. */
export function currentBook(books: SchoolBook[]): SchoolBook | null {
  const open = books.filter((b) => b.unlocked);
  return open.find((b) => !b.exam?.passed || b.payment !== 'PAID') ?? open[open.length - 1] ?? null;
}

/** Short lines under a book: exam result, retake, payment, why it is closed. */
export function BookStatusLines({ book: b }: { book: SchoolBook }) {
  const { t } = useTranslation();
  return (
    <>
      {b.exam?.passed && <span className="block text-green-700">✓ {t('learn.passed_with', { score: Math.round(b.exam.bestPercentage ?? 0) })}</span>}
      {b.exam && !b.exam.passed && b.exam.bestPercentage !== null && (
        <span className="block text-red-700">{t('learn.best_score', { score: Math.round(b.exam.bestPercentage), passMark: b.exam.passMark })}</span>
      )}
      {b.exam && (b.exam.block === 'NEEDS_RETAKE' || b.exam.block === 'RETAKE_DECLINED') && <span className="block text-amber-800">{t('learn.exam_retake_needed')}</span>}
      {b.exam?.block === 'RETAKE_REQUESTED' && <span className="block text-amber-800">{t('learn.exam_retake_requested')}</span>}
      {b.exam && !b.exam.passed && (b.exam.tries ?? 0) > 0 && b.exam.canStart && <span className="block text-green-700">{t('learn.exam_retake_granted')}</span>}
      {b.unlocked && b.payment === 'PAID' && <span className="block text-green-700">✓ {t('learn.paid')}</span>}
      {b.unlocked && (b.payment === 'CLAIMED' || b.payment === 'PENDING') && <span className="block text-amber-800">{t('learn.payment_waiting')}</span>}
      {!b.unlocked && b.lockedBecause === 'PREVIOUS_EXAM' && <span className="block text-slate-600">{t('learn.locked_exam', { number: b.trainingOrder - 1 })}</span>}
      {!b.unlocked && b.lockedBecause === 'PAYMENT' && <span className="block text-slate-600">{t('learn.locked_payment', { number: b.trainingOrder - 1 })}</span>}
      {!b.unlocked && b.lockedBecause === 'NOT_STARTED' && <span className="block text-slate-600">{t('school.locked_not_started')}</span>}
    </>
  );
}

/** Begin my training / what is owed and grace / training paused. */
export function TrainingStatusCard({ summary, onChanged }: { summary: SchoolSummary; onChanged: () => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function begin() {
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/member/training/request');
      onChanged();
    } catch {
      setError(t('learn.failed'));
    } finally {
      setBusy(false);
    }
  }

  if (summary.enrollment !== 'ACTIVE') {
    return (
      <div className="card space-y-2 text-sm">
        <p className="text-slate-700">{t('learn.training_payment_rule', { price: (summary.price ?? 1100).toLocaleString('fr-FR') })}</p>
        {summary.enrollment === 'REVOKED' ? (
          <p className="font-medium text-amber-800">{t('learn.training_stopped')}</p>
        ) : (
          <button type="button" className="btn-primary" disabled={busy} onClick={begin}>
            {t('learn.training_begin')}
          </button>
        )}
        {error && <p className="text-red-700">{error}</p>}
      </div>
    );
  }
  return (
    <div className="card space-y-2 text-sm">
      {(summary.owed?.books ?? 0) > 0 ? (
        <p className="font-medium text-slate-800">{t('learn.owed', { count: summary.owed!.books, amount: summary.owed!.amount.toLocaleString('fr-FR') })}</p>
      ) : (
        <p className="font-medium text-green-700">{t('learn.all_paid')}</p>
      )}
      <GraceBox graceBooks={summary.graceBooks ?? 0} maxGraceBooks={summary.maxGraceBooks ?? 5} request={summary.graceRequest ?? null} onDone={onChanged} />
    </div>
  );
}
