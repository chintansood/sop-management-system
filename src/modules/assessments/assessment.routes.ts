import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import {
  startAttemptHandler,
  submitAttemptHandler,
  getAttemptResultHandler,
  getAttemptsHandler,
} from "./assessment.controller";

const router = Router();

// All assessment routes require authentication
// Ownership checks (is this your assignment/attempt?) happen in the service

// Start a new attempt for an assignment
router.post("/:assignmentId/attempts", authenticate, startAttemptHandler);

// List all attempts for an assignment
router.get("/:assignmentId/attempts", authenticate, getAttemptsHandler);

// Submit answers for an attempt
router.post("/attempts/:attemptId/submit", authenticate, submitAttemptHandler);

// Get result of a specific attempt
router.get("/attempts/:attemptId", authenticate, getAttemptResultHandler);

export default router;