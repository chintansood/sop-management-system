import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import {
  createAssignmentHandler,
  getMyAssignmentsHandler,
  getAllAssignmentsHandler,
} from "./assignment.controller";

const router = Router();

// Staff: see their own assignments
router.get("/me", authenticate, getMyAssignmentsHandler);

// Admin: see all assignments (with optional filters)
router.get(
  "/",
  authenticate,
  authorize("SUPER_ADMIN", "ADMIN", "DEPT_HEAD"),
  getAllAssignmentsHandler
);

// Admin: create assignments
router.post(
  "/",
  authenticate,
  authorize("SUPER_ADMIN", "ADMIN"),
  createAssignmentHandler
);

export default router;