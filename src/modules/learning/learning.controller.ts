import { Request, Response } from "express";
import fs from "fs";
import path from "path";
import { prisma } from "../../lib/db";

/**
 * ─────────────────────────────────────────────────────────────────────────
 * THE GATING LOGIC — why it lives here and how it works
 * ─────────────────────────────────────────────────────────────────────────
 * A staff member must read the SOP before they can take the assessment.
 * This isn't just a UI concern — it needs to be enforced server-side,
 * otherwise a determined staff member could just POST to the assessment
 * endpoint directly without ever opening the document.
 *
 * The gate:
 *   1. Staff opens the SOP → POST /learning/:assignmentId/start
 *      → Creates/updates a LearningProgress row with openedAt timestamp
 *   2. Staff marks it read → POST /learning/:assignmentId/complete
 *      → Sets completedAt timestamp on LearningProgress
 *   3. When staff tries to start an assessment, the assessment module
 *      will check: does a LearningProgress row exist with completedAt set?
 *      If not → 403 "You must read this SOP before taking the assessment"
 *
 * This means bypassing the frontend doesn't help — the backend checks
 * the DB state, not a UI flag.
 * ─────────────────────────────────────────────────────────────────────────
 */

// ---------------------------------------------------------------------------
// GET /api/v1/learning/:assignmentId/document — serve the SOP file
// ---------------------------------------------------------------------------

export async function serveSOPDocumentHandler(req: Request, res: Response) {
  const assignmentId = String(req.params.assignmentId);

  // Verify the assignment belongs to the requesting user
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: {
      sopVersion: { select: { fileUrl: true } },
      sop: { select: { title: true } },
    },
  });

  if (!assignment) {
    return res.status(404).json({ error: "Assignment not found" });
  }

  // Staff can only access their own assignments
  // Admins can access any assignment (for preview/testing)
  const isOwner = assignment.userId === req.user!.userId;
  const isAdmin = ["ADMIN", "SUPER_ADMIN"].includes(req.user!.role);

  if (!isOwner && !isAdmin) {
    return res.status(403).json({ error: "Access denied" });
  }

  const filePath = path.join(process.cwd(), assignment.sopVersion.fileUrl);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Document file not found on server" });
  }

  // Stream the file — don't load the whole thing into memory
  // This handles large PDFs without running out of memory
  const ext = path.extname(filePath).toLowerCase();
  const contentType =
    ext === ".pdf"
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  res.setHeader("Content-Type", contentType);
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${assignment.sop.title}${ext}"`
  );

  const fileStream = fs.createReadStream(filePath);
  fileStream.pipe(res);
}

// ---------------------------------------------------------------------------
// POST /api/v1/learning/:assignmentId/start — mark SOP as opened
// ---------------------------------------------------------------------------

export async function startLearningHandler(req: Request, res: Response) {
  const assignmentId = String(req.params.assignmentId);

  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
  });

  if (!assignment) {
    return res.status(404).json({ error: "Assignment not found" });
  }

  if (assignment.userId !== req.user!.userId) {
    return res.status(403).json({ error: "Access denied" });
  }

  // upsert: create the progress row if it doesn't exist,
  // or leave it as-is if the user has already started (don't overwrite openedAt)
  const progress = await prisma.learningProgress.upsert({
    where: {
      userId_sopVersionId: {
        userId: req.user!.userId,
        sopVersionId: assignment.sopVersionId,
      },
    },
    update: {}, // don't update anything if it already exists
    create: {
      userId: req.user!.userId,
      sopVersionId: assignment.sopVersionId,
      openedAt: new Date(),
    },
  });

  // Update assignment status to IN_PROGRESS if it was NOT_STARTED
  if (assignment.status === "NOT_STARTED") {
    await prisma.assignment.update({
      where: { id: assignmentId },
      data: { status: "IN_PROGRESS" },
    });
  }

  return res.status(200).json({
    message: "Learning started",
    openedAt: progress.openedAt,
    completedAt: progress.completedAt,
    assessmentUnlocked: !!progress.completedAt,
  });
}

// ---------------------------------------------------------------------------
// POST /api/v1/learning/:assignmentId/complete — mark SOP as read
// ---------------------------------------------------------------------------

export async function completeLearningHandler(req: Request, res: Response) {
  const assignmentId = String(req.params.assignmentId);

  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
  });

  if (!assignment) {
    return res.status(404).json({ error: "Assignment not found" });
  }

  if (assignment.userId !== req.user!.userId) {
    return res.status(403).json({ error: "Access denied" });
  }

  // Must have started learning before completing
  const existingProgress = await prisma.learningProgress.findUnique({
    where: {
      userId_sopVersionId: {
        userId: req.user!.userId,
        sopVersionId: assignment.sopVersionId,
      },
    },
  });

  if (!existingProgress) {
    return res.status(400).json({
      error:
        'You must open the SOP document first (call /start before /complete)',
    });
  }

  // Don't overwrite completedAt if already completed
  if (existingProgress.completedAt) {
    return res.status(200).json({
      message: "Already marked as complete",
      completedAt: existingProgress.completedAt,
      assessmentUnlocked: true,
    });
  }

  const progress = await prisma.learningProgress.update({
    where: {
      userId_sopVersionId: {
        userId: req.user!.userId,
        sopVersionId: assignment.sopVersionId,
      },
    },
    data: { completedAt: new Date() },
  });

  return res.status(200).json({
    message: "SOP marked as read — assessment is now unlocked",
    completedAt: progress.completedAt,
    assessmentUnlocked: true,
  });
}

// ---------------------------------------------------------------------------
// GET /api/v1/learning/:assignmentId/status — check progress status
// ---------------------------------------------------------------------------

export async function getLearningStatusHandler(req: Request, res: Response) {
  const assignmentId = String(req.params.assignmentId);

  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: {
      sop: { select: { title: true, category: true } },
      sopVersion: { select: { versionNumber: true } },
    },
  });

  if (!assignment) {
    return res.status(404).json({ error: "Assignment not found" });
  }

  if (
    assignment.userId !== req.user!.userId &&
    !["ADMIN", "SUPER_ADMIN", "DEPT_HEAD"].includes(req.user!.role)
  ) {
    return res.status(403).json({ error: "Access denied" });
  }

  const progress = await prisma.learningProgress.findUnique({
    where: {
      userId_sopVersionId: {
        userId: assignment.userId,
        sopVersionId: assignment.sopVersionId,
      },
    },
  });

  // Count approved questions available for this SOP version
  const approvedQuestionCount = await prisma.question.count({
    where: {
      sopVersionId: assignment.sopVersionId,
      status: "APPROVED",
    },
  });

  return res.status(200).json({
    assignment: {
      id: assignment.id,
      status: assignment.status,
      dueDate: assignment.dueDate,
      sop: assignment.sop,
      sopVersion: assignment.sopVersion,
    },
    learning: {
      opened: !!progress?.openedAt,
      openedAt: progress?.openedAt ?? null,
      completed: !!progress?.completedAt,
      completedAt: progress?.completedAt ?? null,
    },
    assessment: {
      // This is the gate: can only take the assessment if learning is complete
      // AND there are approved questions available
      unlocked: !!progress?.completedAt && approvedQuestionCount > 0,
      approvedQuestionCount,
      reason:
        !progress?.completedAt
          ? "Read the SOP document first"
          : approvedQuestionCount === 0
          ? "No approved questions available yet — contact your admin"
          : "Ready to take assessment",
    },
  });
}