import { prisma } from "../../lib/db";
import { CreateAssignmentInput } from "./assignment.validation";

/**
 * ─────────────────────────────────────────────────────────────────────────
 * WHY ASSIGNMENT LOGIC LIVES IN A SERVICE, NOT THE CONTROLLER
 * ─────────────────────────────────────────────────────────────────────────
 * Assigning a SOP to "all teaching staff" means:
 *   1. Query all users with role = TEACHING_STAFF
 *   2. Check which ones already have this SOP assigned (skip duplicates)
 *   3. Create Assignment rows for the rest
 *   4. Return a summary of what was created vs skipped
 *
 * That's too much logic for a controller. The controller should only
 * validate input, call a service function, and shape the HTTP response.
 * ─────────────────────────────────────────────────────────────────────────
 */

export class SOPNotFoundError extends Error {
  constructor(id: string) {
    super(`SOP ${id} not found or has no active version`);
    this.name = "SOPNotFoundError";
  }
}

export class NoTargetUsersError extends Error {
  constructor() {
    super("No users found matching the assignment target");
    this.name = "NoTargetUsersError";
  }
}

export interface AssignmentResult {
  created: number;
  skipped: number;
  assignmentIds: string[];
}

export async function createAssignments(
  input: CreateAssignmentInput,
  assignedById: string
): Promise<AssignmentResult> {
  const { sopId, dueDate, userIds, departmentId, role } = input;

  // ── Step 1: Verify the SOP exists and has an active version ──────────
  const sop = await prisma.sOP.findUnique({
    where: { id: sopId },
    include: {
      activeVersion: true,
    },
  });

  if (!sop || !sop.activeVersionId) {
    throw new SOPNotFoundError(sopId);
  }

  // ── Step 2: Resolve target users ─────────────────────────────────────
  // Build a where clause based on which targeting option was provided.
  // The result is always the same: a flat list of user IDs to assign to.
  let targetUserIds: string[] = [];

  if (userIds && userIds.length > 0) {
    // Direct user assignment — verify all provided IDs actually exist
    const users = await prisma.user.findMany({
      where: { id: { in: userIds }, isActive: true },
      select: { id: true },
    });
    targetUserIds = users.map((u) => u.id);
  } else if (departmentId) {
    // All active users in a department
    const users = await prisma.user.findMany({
      where: { departmentId, isActive: true },
      select: { id: true },
    });
    targetUserIds = users.map((u) => u.id);
  } else if (role) {
    // All active users with a specific role
    const users = await prisma.user.findMany({
      where: { role, isActive: true },
      select: { id: true },
    });
    targetUserIds = users.map((u) => u.id);
  }

  if (targetUserIds.length === 0) {
    throw new NoTargetUsersError();
  }

  // ── Step 3: Skip users who already have this SOP assigned ────────────
  // Why? Re-assigning an already-assigned SOP would create a duplicate
  // Assignment row, which would confuse the staff member's dashboard
  // (two entries for the same SOP) and the compliance reports.
  const existingAssignments = await prisma.assignment.findMany({
    where: {
      sopId,
      userId: { in: targetUserIds },
      status: { notIn: ["STALE"] },
    },
    select: { userId: true },
  });

  const alreadyAssignedUserIds = new Set(
    existingAssignments.map((a) => a.userId)
  );

  const newTargetUserIds = targetUserIds.filter(
    (id) => !alreadyAssignedUserIds.has(id)
  );

  const skipped = targetUserIds.length - newTargetUserIds.length;

  if (newTargetUserIds.length === 0) {
    return { created: 0, skipped, assignmentIds: [] };
  }

  // ── Step 4: Create Assignment rows ───────────────────────────────────
  // Why createMany + then findMany instead of create in a loop?
  // createMany is a single SQL INSERT with multiple rows — much faster
  // than N separate INSERT statements for large departments.
  // The downside: createMany doesn't return the created IDs on Postgres
  // in all Prisma versions, so we fetch them after.
  await prisma.assignment.createMany({
    data: newTargetUserIds.map((userId) => ({
      userId,
      sopId,
      sopVersionId: sop.activeVersionId!,
      assignedById,
      dueDate: dueDate ? new Date(dueDate) : null,
      status: "NOT_STARTED",
    })),
  });

  // Fetch the just-created assignments to return their IDs
  const created = await prisma.assignment.findMany({
    where: {
      sopId,
      userId: { in: newTargetUserIds },
      assignedById,
    },
    select: { id: true },
    orderBy: { createdAt: "desc" },
    take: newTargetUserIds.length,
  });

  return {
    created: created.length,
    skipped,
    assignmentIds: created.map((a) => a.id),
  };
}

// ---------------------------------------------------------------------------
// Get all assignments for the current user (staff dashboard)
// ---------------------------------------------------------------------------

export async function getMyAssignments(userId: string) {
  return prisma.assignment.findMany({
    where: { userId },
    include: {
      sop: {
        select: { id: true, title: true, category: true },
      },
      sopVersion: {
        select: { versionNumber: true, status: true },
      },
      attempts: {
        orderBy: { attemptNumber: "asc" as const },
        select: {
          id: true,
          attemptNumber: true,
          score: true,
          passed: true,
          startedAt: true,
          submittedAt: true,
        },
      },
    },
    orderBy: [{ status: "asc" }, { dueDate: "asc" }],
  });
}

// ---------------------------------------------------------------------------
// Get all assignments (admin view — can filter by department/SOP)
// ---------------------------------------------------------------------------

export async function getAllAssignments(filters: {
  sopId?: string;
  departmentId?: string;
  status?: string;
}) {
  const { sopId, departmentId, status } = filters;

  return prisma.assignment.findMany({
    where: {
      ...(sopId ? { sopId } : {}),
      ...(status ? { status: status as never } : {}),
      ...(departmentId
        ? { user: { departmentId } }
        : {}),
    },
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          email: true,
          role: true,
          department: { select: { name: true } },
        },
      },
      sop: { select: { id: true, title: true, category: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}
export async function resetAttempts(assignmentId: string) {
  const attempts = await prisma.attempt.findMany({
    where: { assignmentId },
    select: { id: true },
  })

  const attemptIds = attempts.map(a => a.id)

  await prisma.$transaction([
    prisma.attemptAnswer.deleteMany({
      where: { attemptId: { in: attemptIds } },
    }),
    prisma.attempt.deleteMany({
      where: { assignmentId },
    }),
    prisma.assignment.update({
      where: { id: assignmentId },
      data: { status: "NOT_STARTED" },
    }),
  ])

  return { message: "Attempts reset successfully. Staff can retake the assessment." }
}