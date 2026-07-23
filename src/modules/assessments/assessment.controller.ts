import { Request, Response } from "express";
import {
  startAttempt,
  submitAttempt,
  getAttemptResult,
  getAttemptsByAssignment,
  AssignmentNotFoundError,
  LearningNotCompleteError,
  NoApprovedQuestionsError,
  MaxAttemptsReachedError,
  AttemptNotFoundError,
  AttemptAlreadySubmittedError,
  InvalidAnswerError,
} from "./assessment.service";
import { z } from "zod";

// Validation schema for answer submission
const SubmitAnswersSchema = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.string().uuid(),
        selectedOptionId: z.string().uuid(),
      })
    )
    .min(1, "At least one answer is required"),
});

// ---------------------------------------------------------------------------
// POST /api/v1/assessments/:assignmentId/attempts — start a new attempt
// ---------------------------------------------------------------------------

export async function startAttemptHandler(req: Request, res: Response) {
  const assignmentId = String(req.params.assignmentId);

  try {
    const result = await startAttempt(assignmentId, req.user!.userId);
    return res.status(201).json(result);
  } catch (err) {
    if (err instanceof AssignmentNotFoundError)
      return res.status(404).json({ error: err.message });
    if (err instanceof LearningNotCompleteError)
      return res.status(403).json({ error: err.message });
    if (err instanceof NoApprovedQuestionsError)
      return res.status(422).json({ error: err.message });
    if (err instanceof MaxAttemptsReachedError)
      return res.status(429).json({ error: err.message });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// POST /api/v1/assessments/attempts/:attemptId/submit — submit answers
// ---------------------------------------------------------------------------

export async function submitAttemptHandler(req: Request, res: Response) {
  const attemptId = String(req.params.attemptId);

  const parsed = SubmitAnswersSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      details: parsed.error.issues.map((i: { message: string }) => i.message),
    });
  }

  try {
    const result = await submitAttempt(
      attemptId,
      req.user!.userId,
      parsed.data.answers
    );
    return res.status(200).json(result);
  } catch (err) {
    if (err instanceof AttemptNotFoundError)
      return res.status(404).json({ error: err.message });
    if (err instanceof AttemptAlreadySubmittedError)
      return res.status(409).json({ error: err.message });
    if (err instanceof InvalidAnswerError)
      return res.status(400).json({ error: err.message });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// GET /api/v1/assessments/attempts/:attemptId — get attempt result
// ---------------------------------------------------------------------------

export async function getAttemptResultHandler(req: Request, res: Response) {
  const attemptId = String(req.params.attemptId);

  try {
    const result = await getAttemptResult(attemptId, req.user!.userId);
    return res.status(200).json(result);
  } catch (err) {
    if (err instanceof AttemptNotFoundError)
      return res.status(404).json({ error: err.message });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// GET /api/v1/assessments/:assignmentId/attempts — list all attempts
// ---------------------------------------------------------------------------

export async function getAttemptsHandler(req: Request, res: Response) {
  const assignmentId = String(req.params.assignmentId);

  try {
    const result = await getAttemptsByAssignment(assignmentId, req.user!.userId);
    return res.status(200).json(result);
  } catch (err) {
    if (err instanceof AssignmentNotFoundError)
      return res.status(404).json({ error: err.message });
    throw err;
  }
}