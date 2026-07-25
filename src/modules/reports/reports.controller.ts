import { Request, Response } from "express";
import {
  getOverview,
  getComplianceBySOP,
  getComplianceByDepartment,
  getStaffCompliance,
  getOverdueAssignments,
  getGapAnalysis,
} from "./reports.service";

// ---------------------------------------------------------------------------
// GET /api/v1/reports/overview
// Powers the 3 stat cards on admin dashboard
// ---------------------------------------------------------------------------
export async function getOverviewHandler(req: Request, res: Response) {
  try {
    const data = await getOverview(req.user!.userId);
    return res.status(200).json(data);
  } catch (err) {
    throw err;
  }
}

// ---------------------------------------------------------------------------
// GET /api/v1/reports/by-sop
// Powers the compliance report table — pass rate per SOP
// ---------------------------------------------------------------------------
export async function getBySopHandler(req: Request, res: Response) {
  try {
    const data = await getComplianceBySOP();
    return res.status(200).json({ sops: data });
  } catch (err) {
    throw err;
  }
}

// ---------------------------------------------------------------------------
// GET /api/v1/reports/by-department
// Powers the department breakdown cards
// ---------------------------------------------------------------------------
export async function getByDepartmentHandler(req: Request, res: Response) {
  try {
    const data = await getComplianceByDepartment();
    return res.status(200).json({ departments: data });
  } catch (err) {
    throw err;
  }
}

// ---------------------------------------------------------------------------
// GET /api/v1/reports/staff/:userId
// Powers individual staff compliance view
// ---------------------------------------------------------------------------
export async function getStaffComplianceHandler(req: Request, res: Response) {
  const userId = String(req.params.userId);
  try {
    const data = await getStaffCompliance(userId);
    return res.status(200).json(data);
  } catch (err: any) {
    if (err.message === "Staff member not found")
      return res.status(404).json({ error: err.message });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// GET /api/v1/reports/overdue
// Powers the overdue staff list
// ---------------------------------------------------------------------------
export async function getOverdueHandler(req: Request, res: Response) {
  try {
    const data = await getOverdueAssignments();
    return res.status(200).json({ overdue: data, count: data.length });
  } catch (err) {
    throw err;
  }
}

// ---------------------------------------------------------------------------
// GET /api/v1/reports/gap-analysis/:sopVersionId
// Powers the gap analysis — which questions staff get wrong most
// ---------------------------------------------------------------------------
export async function getGapAnalysisHandler(req: Request, res: Response) {
  const sopVersionId = String(req.params.sopVersionId);
  try {
    const data = await getGapAnalysis(sopVersionId);
    return res.status(200).json(data);
  } catch (err) {
    throw err;
  }
}
