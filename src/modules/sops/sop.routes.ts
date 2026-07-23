import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { sopUpload } from "../../lib/upload";
import {
  uploadSOPHandler,
  uploadSOPVersionHandler,
  generateQuestionsHandler,
  listQuestionsHandler,
  reviewQuestionHandler,
} from "./sop.controller";
// Add these to your existing sop.routes.ts

import {
  publishNewVersionHandler,
  getVersionHistoryHandler,
  getStaleAssignmentsHandler,
} from "./sop.controller";
const router = Router();

// New version of existing SOP
router.post("/:sopId/versions", authenticate, authorize("ADMIN", "SUPER_ADMIN"), sopUpload.single("document"), publishNewVersionHandler);

// Version history
router.get("/:sopId/versions", authenticate, authorize("ADMIN", "SUPER_ADMIN"), getVersionHistoryHandler);

// Staff — get their stale assignments
router.get("/stale", authenticate, getStaleAssignmentsHandler);


// All SOP management routes require authentication + admin role
const adminOnly = [authenticate, authorize("SUPER_ADMIN", "ADMIN")];

// SOP upload — multipart form with a file field named "document"
router.post(
  "/",
  ...adminOnly,
  sopUpload.single("document"),
  uploadSOPHandler
);
import { getAllSOPsHandler } from "./sop.controller"

// Add before other routes
router.get("/", authenticate, authorize("ADMIN", "SUPER_ADMIN", "DEPT_HEAD"), getAllSOPsHandler);
// Upload a new version of an existing SOP
router.post(
  "/:sopId/versions",
  ...adminOnly,
  sopUpload.single("document"),
  uploadSOPVersionHandler
);

// Trigger AI question generation for a specific version
// Optional query param: ?count=10 (default 10, max 20)
router.post(
  "/versions/:sopVersionId/generate-questions",
  ...adminOnly,
  generateQuestionsHandler
);

// List questions for a version with optional status filter
// ?status=DRAFT | APPROVED | REJECTED | ALL
router.get(
  "/versions/:sopVersionId/questions",
  ...adminOnly,
  listQuestionsHandler
);

// Review (approve/reject/edit) a single draft question
router.patch(
  "/questions/:questionId/review",
  ...adminOnly,
  reviewQuestionHandler
);

export default router;