import { Prisma } from '@prisma/client';
import { prisma } from './prisma';

// Thrown for any expected, client-facing failure in the attempt lifecycle
// (not found, already submitted, limit reached, bad data) so route handlers
// can translate it into the right HTTP status instead of a generic 500.
export class AssessmentSubmissionError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Starts a new Attempt for a Person against an Assessment.
 *
 * Enforces (server-side, never trusting the client):
 *  - the Assessment exists and has been published (DRAFT cannot be attempted)
 *  - Assessment.maxAttempts (null = unlimited)
 *  - attemptNumber uniqueness — a concurrent double-start is caught as a
 *    database constraint violation and turned into a clean 409, never a 500
 *
 * The FIRST attempt against a PUBLISHED assessment locks it (PUBLISHED ->
 * LOCKED) in the same transaction as the attempt's creation, so the
 * assessment's questions/options become permanently uneditable from the
 * instant a real attempt exists against them.
 */
export async function createAttempt(personId: string, assessmentId: string) {
  const person = await prisma.person.findUnique({ where: { id: personId } });
  if (!person) throw new AssessmentSubmissionError(404, 'Person not found.');

  const assessment = await prisma.assessment.findUnique({ where: { id: assessmentId } });
  if (!assessment) throw new AssessmentSubmissionError(404, 'Assessment not found.');
  if (assessment.status === 'DRAFT') {
    throw new AssessmentSubmissionError(400, 'This assessment has not been published yet.');
  }

  const existingCount = await prisma.attempt.count({ where: { personId, assessmentId } });
  if (assessment.maxAttempts !== null && existingCount >= assessment.maxAttempts) {
    throw new AssessmentSubmissionError(
      409,
      'This person has already used the maximum number of attempts for this assessment.',
    );
  }

  const attemptNumber = existingCount + 1;

  try {
    return await prisma.$transaction(async (tx) => {
      const attempt = await tx.attempt.create({ data: { personId, assessmentId, attemptNumber } });
      if (assessment.status === 'PUBLISHED') {
        await tx.assessment.update({ where: { id: assessmentId }, data: { status: 'LOCKED' } });
      }
      return attempt;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // Two concurrent "start attempt" requests raced for the same
      // attemptNumber — the database's unique constraint is the final
      // protection here, exactly as required. Never a generic 500.
      throw new AssessmentSubmissionError(
        409,
        'An attempt was already started for this person and assessment at the same moment. Please try again.',
      );
    }
    throw err;
  }
}

interface SubmittedAnswer {
  questionId: string;
  selectedOptionId: string;
}

/**
 * Submits an in-progress Attempt. The server — never the client — computes
 * wasCorrect per answer, score, maxScore, percentage, and passed, reading
 * the Assessment's CURRENT pass mark and storing it as passMarkAtAttempt
 * (a permanent historical snapshot; it is never recalculated later even if
 * the pass mark could theoretically change, which it can't once locked).
 *
 * Edge cases handled deliberately:
 *  - a question with no submitted answer simply scores 0 for that question
 *    (Phase 3B does not require every question to be answered)
 *  - a duplicate answer for the same question is rejected (400) rather than
 *    silently taking the first/last one — ambiguous input, no scoring
 *  - a question/option ID that doesn't belong to this assessment/question
 *    is rejected (400) — never silently ignored
 *  - zero questions -> maxScore 0 -> percentage 0 (never divides by zero)
 */
export async function submitAttempt(attemptId: string, answers: SubmittedAnswer[]) {
  try {
    return await prisma.$transaction(async (tx) => {
      const attempt = await tx.attempt.findUnique({ where: { id: attemptId } });
      if (!attempt) throw new AssessmentSubmissionError(404, 'Attempt not found.');
      if (attempt.status === 'SUBMITTED') {
        throw new AssessmentSubmissionError(409, 'This attempt has already been submitted.');
      }

      const assessment = await tx.assessment.findUnique({ where: { id: attempt.assessmentId } });
      if (!assessment) throw new AssessmentSubmissionError(404, 'Assessment not found.');

      const questions = await tx.question.findMany({
        where: { assessmentId: assessment.id },
        include: { options: true },
      });
      const questionMap = new Map(questions.map((q) => [q.id, q]));

      const seenQuestionIds = new Set<string>();
      const validated: { questionId: string; selectedOptionId: string; wasCorrect: boolean }[] = [];

      for (const a of answers) {
        if (seenQuestionIds.has(a.questionId)) {
          throw new AssessmentSubmissionError(400, 'Duplicate answer submitted for the same question.');
        }
        seenQuestionIds.add(a.questionId);

        const question = questionMap.get(a.questionId);
        if (!question) {
          throw new AssessmentSubmissionError(400, 'A submitted question does not belong to this assessment.');
        }
        const option = question.options.find((o) => o.id === a.selectedOptionId);
        if (!option) {
          throw new AssessmentSubmissionError(400, 'A submitted option does not belong to its question.');
        }
        validated.push({ questionId: a.questionId, selectedOptionId: a.selectedOptionId, wasCorrect: option.isCorrect });
      }

      const maxScore = questions.reduce((sum, q) => sum + q.points, 0);
      const score = validated.reduce((sum, a) => sum + (a.wasCorrect ? questionMap.get(a.questionId)!.points : 0), 0);
      const percentage = maxScore > 0 ? (score / maxScore) * 100 : 0;
      const passMarkAtAttempt = assessment.passMark;
      const passed = percentage >= passMarkAtAttempt;

      if (validated.length > 0) {
        await tx.answer.createMany({
          data: validated.map((a) => ({
            attemptId,
            questionId: a.questionId,
            selectedOptionId: a.selectedOptionId,
            wasCorrect: a.wasCorrect,
          })),
        });
      }

      const updated = await tx.attempt.update({
        where: { id: attemptId },
        data: {
          submittedAt: new Date(),
          score,
          maxScore,
          percentage,
          passMarkAtAttempt,
          passed,
          status: 'SUBMITTED',
        },
      });

      // Idempotent: a retried submission request that somehow reaches this
      // point again (it normally can't — the SUBMITTED check above rejects
      // it first) still cannot create a second event, thanks to the unique
      // constraint on (personId, type, sourceType, sourceId).
      await tx.participationEvent.upsert({
        where: {
          personId_type_sourceType_sourceId: {
            personId: attempt.personId,
            type: 'ASSESSMENT_COMPLETED',
            sourceType: 'ATTEMPT',
            sourceId: attempt.id,
          },
        },
        create: {
          personId: attempt.personId,
          type: 'ASSESSMENT_COMPLETED',
          sourceType: 'ATTEMPT',
          sourceId: attempt.id,
        },
        update: {},
      });

      return updated;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // A concurrent duplicate submission for the same attempt/question raced
      // past the SUBMITTED check and hit the Answer unique constraint instead.
      throw new AssessmentSubmissionError(409, 'This attempt has already been submitted.');
    }
    throw err;
  }
}
