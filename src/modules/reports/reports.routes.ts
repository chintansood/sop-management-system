import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import {
  getOverviewHandler,
  getBySopHandler,
  getByDepartmentHandler,
  getStaffComplianceHandler,
  getOverdueHandler,
  getGapAnalysisHandler,
} from "./reports.controller";

const router = Router();

// All report endpoints are admin only
// Staff members don't see school-wide compliance data
router.use(authenticate);
router.use(authorize("SUPER_ADMIN", "ADMIN", "DEPT_HEAD"));

// Overview — 3 stat cards on dashboard
router.get("/overview", getOverviewHandler);

// Compliance by SOP — report table
router.get("/by-sop", getBySopHandler);

// Compliance by department — department cards
router.get("/by-department", getByDepartmentHandler);

// Individual staff compliance
router.get("/staff/:userId", getStaffComplianceHandler);

// All overdue assignments
router.get("/overdue", getOverdueHandler);

// Gap analysis for a specific SOP version
router.get("/gap-analysis/:sopVersionId", getGapAnalysisHandler);

export default router;