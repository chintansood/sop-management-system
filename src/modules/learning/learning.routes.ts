import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import {
  serveSOPDocumentHandler,
  startLearningHandler,
  completeLearningHandler,
  getLearningStatusHandler,
} from "./learning.controller";

const router = Router();

// All learning routes require authentication
// Ownership checks (is this your assignment?) happen in the controller

// Get the SOP document (serves the actual PDF/DOCX file)
router.get("/:assignmentId/document", authenticate, serveSOPDocumentHandler);

// Get learning + assessment status for an assignment
router.get("/:assignmentId/status", authenticate, getLearningStatusHandler);

// Mark SOP as opened (call when staff clicks "Read SOP")
router.post("/:assignmentId/start", authenticate, startLearningHandler);

// Mark SOP as read (call when staff clicks "I've read this SOP")
router.post("/:assignmentId/complete", authenticate, completeLearningHandler);

export default router;