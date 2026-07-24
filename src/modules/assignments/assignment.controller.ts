import { Request, Response } from "express";
import { CreateAssignmentSchema } from "./assignment.validation";
import {
  createAssignments,
  getMyAssignments,
  getAllAssignments,
  SOPNotFoundError,
  NoTargetUsersError,
  resetAttempts,
} from "./assignment.service";

// ---------------------------------------------------------------------------
// POST /api/v1/assignments — Admin creates assignment(s)
// ---------------------------------------------------------------------------

export async function createAssignmentHandler(req: Request, res: Response) {
  const parsed = CreateAssignmentSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      details: parsed.error.issues.map((i: { message: string }) => i.message),
    });
  }

  try {
    const result = await createAssignments(parsed.data, req.user!.userId);

    return res.status(201).json({
      message: `Created ${result.created} assignment(s), skipped ${result.skipped} (already assigned)`,
      ...result,
    });
  } catch (err) {
    if (err instanceof SOPNotFoundError) {
      return res.status(404).json({ error: err.message });
    }
    if (err instanceof NoTargetUsersError) {
      return res.status(404).json({ error: err.message });
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// GET /api/v1/assignments/me — Staff sees their own assigned SOPs
// ---------------------------------------------------------------------------

export async function getMyAssignmentsHandler(req: Request, res: Response) {
  const assignments = await getMyAssignments(req.user!.userId);
  return res.status(200).json({ assignments });
}

// ---------------------------------------------------------------------------
// GET /api/v1/assignments — Admin sees all assignments (with filters)
// ---------------------------------------------------------------------------

export async function getAllAssignmentsHandler(req: Request, res: Response) {
  const { sopId, departmentId, status } = req.query;

  const assignments = await getAllAssignments({
    ...(sopId && { sopId: sopId as string }),
    ...(departmentId && { departmentId: departmentId as string }),
    ...(status && { status: status as string }),
  });

  return res.status(200).json({ assignments });
}
export async function resetAttemptsHandler(req: Request, res: Response) {
  const assignmentId = Array.isArray(req.params.assignmentId)
    ? req.params.assignmentId[0]
    : req.params.assignmentId

  try {
    const result = await resetAttempts(assignmentId)
    return res.status(200).json(result)
  } catch (err) {
    throw err
  }
}