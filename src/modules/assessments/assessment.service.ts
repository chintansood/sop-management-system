import { prisma } from "../../lib/db";

/**
 * ─────────────────────────────────────────────────────────────────────────
 * THE ASSESSMENT ENGINE
 * ─────────────────────────────────────────────────────────────────────────
 * This is the most security-sensitive module in the whole system.
 * Three things must NEVER happen:
 *
 *   1. A staff member sees the correct answers before submitting
 *   2. Scoring happens on the client — it MUST happen server-side here
 *   3. A staff member can take an assessment without having read the SOP
 *
 * Every one of those is enforced in this file, not just in the UI.
 * ─────────────────────────────────────────────────────────────────────────
 */

// ---------------------------------------------------------------------------
// Configuration — these would move to DB settings in a future enhancement
// ---------------------------------------------------------------------------

const PASS_PERCENTAGE = 80; // minimum score to pass
const MAX_ATTEMPTS = 3;     // max retakes before admin intervention needed

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class AssignmentNotFoundError extends Error {
  constructor() { super("Assignment not found"); this.name = "AssignmentNotFoundError"; }
}

export class LearningNotCompleteError extends Error {
  constructor() { super("You must read the SOP document before taking the assessment"); this.name = "LearningNotCompleteError"; }
}

export class NoApprovedQuestionsError extends Error {
  constructor() { super("No approved questions available for this assessment — contact your admin"); this.name = "NoApprovedQuestionsError"; }
}

export class MaxAttemptsReachedError extends Error {
  constructor() { super(`Maximum attempts (${MAX_ATTEMPTS}) reached — contact your admin to reset`); this.name = "MaxAttemptsReachedError"; }
}

export class AttemptNotFoundError extends Error {
  constructor() { super("Attempt not found"); this.name = "AttemptNotFoundError"; }
}

export class AttemptAlreadySubmittedError extends Error {
  constructor() { super("This attempt has already been submitted"); this.name = "AttemptAlreadySubmittedError"; }
}

export class InvalidAnswerError extends Error {
  constructor(msg: string) { super(msg); this.name = "InvalidAnswerError"; }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QuestionForAttempt {
  id: string;
  text: string;
  difficulty: string;
  options: Array<{
    id: string;
    text: string;
    // NOTE: isCorrect is deliberately NOT included here
    // The correct answer must never be sent to the client before submission
  }>;
}

export interface SnapshotQuestion extends QuestionForAttempt {
  correctOptionId: string; // stored in snapshot for scoring, never sent to client
  explanation: string | null;
}

export interface SubmitAnswer {
  questionId: string;
  selectedOptionId: string;
}

// ---------------------------------------------------------------------------
// START ATTEMPT
// Creates a new Attempt row, snapshots the question set, returns questions
// WITHOUT correct answers
// ---------------------------------------------------------------------------

export async function startAttempt(assignmentId: string, userId: string) {
  // ── 1. Verify assignment belongs to this user ─────────────────────────
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: { sopVersion: true },
  });

  if (!assignment || assignment.userId !== userId) {
    throw new AssignmentNotFoundError();
  }

  // ── 2. Check learning is complete (the gate) ──────────────────────────
  const learningProgress = await prisma.learningProgress.findUnique({
    where: {
      userId_sopVersionId: {
        userId,
        sopVersionId: assignment.sopVersionId,
      },
    },
  });

  if (!learningProgress?.completedAt) {
    throw new LearningNotCompleteError();
  }

  // ── 3. Check max attempts not exceeded ───────────────────────────────
  const attemptCount = await prisma.attempt.count({
    where: { assignmentId },
  });

  if (attemptCount >= MAX_ATTEMPTS) {
    throw new MaxAttemptsReachedError();
  }

  // ── 4. Fetch approved questions for this SOP version ─────────────────
  const questions = await prisma.question.findMany({
    where: {
      sopVersionId: assignment.sopVersionId,
      status: "APPROVED",
    },
    include: { options: true },
  });

  if (questions.length === 0) {
    throw new NoApprovedQuestionsError();
  }

  // ── 5. Build the snapshot ─────────────────────────────────────────────
  // The snapshot freezes EVERYTHING about the questions at this moment:
  // text, options, correct answers. Even if an admin edits questions later,
  // this attempt's record stays accurate for audit purposes.
  //
  // Shuffle question order and option order per attempt — this prevents
  // staff from sharing "the answer to question 3 is B" since the order
  // is different for every attempt.
  const shuffledQuestions = shuffle(questions);

  const snapshot: SnapshotQuestion[] = shuffledQuestions.map((q) => {
    const shuffledOptions = shuffle(q.options);
    const correctOption = shuffledOptions.find((o) => o.isCorrect)!;

    return {
      id: q.id,
      text: q.text,
      difficulty: q.difficulty,
      explanation: q.explanation,
      correctOptionId: correctOption.id, // stored in snapshot, NOT sent to client
      options: shuffledOptions.map((o) => ({
        id: o.id,
        text: o.text,
        // isCorrect deliberately omitted — never expose before submission
      })),
    };
  });

  // ── 6. Create the Attempt row ─────────────────────────────────────────
  const attempt = await prisma.attempt.create({
    data: {
      assignmentId,
      attemptNumber: attemptCount + 1,
      questionSnapshot: snapshot as object,
    },
  });

  // ── 7. Update assignment status to IN_PROGRESS ────────────────────────
  if (assignment.status === "NOT_STARTED") {
    await prisma.assignment.update({
      where: { id: assignmentId },
      data: { status: "IN_PROGRESS" },
    });
  }

  // ── 8. Return questions WITHOUT correct answers ───────────────────────
  // Strip correctOptionId from what we return — it's in the DB snapshot
  // but the client must never see it before submitting
  return {
    attemptId: attempt.id,
    attemptNumber: attempt.attemptNumber,
    totalQuestions: snapshot.length,
    passPercentage: PASS_PERCENTAGE,
    questions: snapshot.map(({ correctOptionId, explanation, ...q }) => q),
    startedAt: attempt.startedAt,
  };
}

// ---------------------------------------------------------------------------
// SUBMIT ATTEMPT
// Scores server-side, saves answers, updates assignment status
// ---------------------------------------------------------------------------

export async function submitAttempt(
  attemptId: string,
  userId: string,
  answers: SubmitAnswer[]
) {
  // ── 1. Fetch the attempt and verify ownership ─────────────────────────
  const attempt = await prisma.attempt.findUnique({
    where: { id: attemptId },
    include: { assignment: true },
  });

  if (!attempt || attempt.assignment.userId !== userId) {
    throw new AttemptNotFoundError();
  }

  if (attempt.submittedAt) {
    throw new AttemptAlreadySubmittedError();
  }

  // ── 2. Load the snapshot (source of truth for scoring) ───────────────
  const snapshot = attempt.questionSnapshot as unknown as SnapshotQuestion[];

  // ── 3. Validate that all questions were answered ──────────────────────
  const answeredQuestionIds = new Set(answers.map((a) => a.questionId));
  const snapshotQuestionIds = new Set(snapshot.map((q) => q.id));

  for (const qId of snapshotQuestionIds) {
    if (!answeredQuestionIds.has(qId)) {
      throw new InvalidAnswerError(`Missing answer for question ${qId}`);
    }
  }

  // ── 4. Score server-side using the snapshot ───────────────────────────
  // This is the critical part: we score against the snapshot's
  // correctOptionId, NOT the current state of the Question table.
  // Even if an admin changes the correct answer after this attempt started,
  // it doesn't affect this attempt's scoring.
  let correctCount = 0;
  const scoredAnswers = answers.map((answer) => {
    const snapshotQuestion = snapshot.find((q) => q.id === answer.questionId);

    if (!snapshotQuestion) {
      throw new InvalidAnswerError(
        `Question ${answer.questionId} was not part of this attempt`
      );
    }

    const isCorrect = answer.selectedOptionId === snapshotQuestion.correctOptionId;
    if (isCorrect) correctCount++;

    return {
      questionId: answer.questionId,
      selectedOptionId: answer.selectedOptionId,
      isCorrect,
      explanation: isCorrect ? null : snapshotQuestion.explanation,
    };
  });

  const score = Math.round((correctCount / snapshot.length) * 100);
  const passed = score >= PASS_PERCENTAGE;

  // ── 5. Save answers and update attempt ───────────────────────────────
  await prisma.$transaction(async (tx) => {
    // Save each answer
    await tx.attemptAnswer.createMany({
      data: scoredAnswers.map((a) => ({
        attemptId,
        questionId: a.questionId,
        selectedOptionId: a.selectedOptionId,
        isCorrect: a.isCorrect,
      })),
    });

    // Update the attempt with score and submission time
    await tx.attempt.update({
      where: { id: attemptId },
      data: {
        submittedAt: new Date(),
        score,
        passed,
      },
    });

    // Update the assignment status
    await tx.assignment.update({
      where: { id: attempt.assignmentId },
      data: {
        status: passed ? "PASSED" : "FAILED",
      },
    });
  });

  // ── 6. Return full result with explanations ───────────────────────────
  return {
    attemptId,
    attemptNumber: attempt.attemptNumber,
    score,
    passed,
    correctCount,
    totalQuestions: snapshot.length,
    passPercentage: PASS_PERCENTAGE,
    assignmentStatus: passed ? "PASSED" : "FAILED",
    canRetake: !passed && attempt.attemptNumber < MAX_ATTEMPTS,
    answers: scoredAnswers,
  };
}

// ---------------------------------------------------------------------------
// GET ATTEMPT RESULT
// Returns a past attempt's result for review
// ---------------------------------------------------------------------------

export async function getAttemptResult(attemptId: string, userId: string) {
  const attempt = await prisma.attempt.findUnique({
    where: { id: attemptId },
    include: {
      assignment: {
        include: { sop: { select: { title: true } } },
      },
      answers: true,
    },
  });

  if (!attempt || attempt.assignment.userId !== userId) {
    throw new AttemptNotFoundError();
  }

  if (!attempt.submittedAt) {
    return {
      attemptId,
      status: "IN_PROGRESS",
      message: "This attempt has not been submitted yet",
    };
  }

  const snapshot = attempt.questionSnapshot as unknown as SnapshotQuestion[];

  // Enrich answers with question text and explanation for review
  const enrichedAnswers = attempt.answers.map((answer) => {
    const snapshotQ = snapshot.find((q) => q.id === answer.questionId);
    return {
      questionText: snapshotQ?.text ?? "Question not found",
      selectedOptionId: answer.selectedOptionId,
      isCorrect: answer.isCorrect,
      explanation: !answer.isCorrect ? snapshotQ?.explanation : null,
      options: snapshotQ?.options ?? [],
    };
  });

  return {
    attemptId,
    attemptNumber: attempt.attemptNumber,
    sopTitle: attempt.assignment.sop.title,
    score: attempt.score,
    passed: attempt.passed,
    submittedAt: attempt.submittedAt,
    answers: enrichedAnswers,
  };
}

// ---------------------------------------------------------------------------
// GET ALL ATTEMPTS for an assignment
// ---------------------------------------------------------------------------

export async function getAttemptsByAssignment(
  assignmentId: string,
  userId: string
) {
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
  });

  if (!assignment || assignment.userId !== userId) {
    throw new AssignmentNotFoundError();
  }

  const attempts = await prisma.attempt.findMany({
    where: { assignmentId },
    orderBy: { attemptNumber: "asc" },
    select: {
      id: true,
      attemptNumber: true,
      score: true,
      passed: true,
      startedAt: true,
      submittedAt: true,
    },
  });

  return {
    assignmentId,
    maxAttempts: MAX_ATTEMPTS,
    attemptsUsed: attempts.length,
    attemptsRemaining: Math.max(0, MAX_ATTEMPTS - attempts.length),
    attempts,
  };
}

// ---------------------------------------------------------------------------
// Utility: Fisher-Yates shuffle
// Randomizes array order — used for both questions and options
// ---------------------------------------------------------------------------

function shuffle<T>(array: T[]): T[] {
  const arr = [...array]; // don't mutate the original
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = temp;
  }
  return arr;
}