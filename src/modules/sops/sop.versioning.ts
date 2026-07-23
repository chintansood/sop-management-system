import { prisma } from "../../lib/db";

export class VersionNotFoundError extends Error {
  constructor() { super("SOP version not found"); this.name = "VersionNotFoundError"; }
}

export class SOPNotFoundError extends Error {
  constructor() { super("SOP not found"); this.name = "SOPNotFoundError"; }
}

// ---------------------------------------------------------------------------
// PUBLISH NEW VERSION
// ---------------------------------------------------------------------------
export async function publishNewVersion(
  sopId: string,
  fileUrl: string,
  adminId: string
) {
  const sop = await prisma.sOP.findUnique({
    where: { id: sopId },
    include: {
      versions: {
        orderBy: { versionNumber: "desc" },
        take: 1,
      },
    },
  });

  if (!sop) throw new SOPNotFoundError();

  const latestVersion    = sop.versions[0];
  const newVersionNumber = latestVersion ? latestVersion.versionNumber + 1 : 1;

  // Find all staff who PASSED this SOP
  const passedAssignments = await prisma.assignment.findMany({
    where: { sopId, status: "PASSED" },
    select: { userId: true, dueDate: true },
  });

  const result = await prisma.$transaction(async (tx) => {

    // Archive current active version
    if (sop.activeVersionId) {
      await tx.sOPVersion.update({
        where: { id: sop.activeVersionId },
        data:  { status: "ARCHIVED" },
      });
    }

    // Create new version — include uploadedById
    const newVersion = await tx.sOPVersion.create({
      data: {
        sopId,
        versionNumber: newVersionNumber,
        fileUrl,
        status:        "DRAFT",
        uploadedById:  adminId,
      },
    });

    // Update SOP activeVersionId
    await tx.sOP.update({
      where: { id: sopId },
      data:  { activeVersionId: newVersion.id },
    });

    // Mark all PASSED assignments as STALE
    const staleResult = await tx.assignment.updateMany({
      where: { sopId, status: "PASSED" },
      data:  { status: "STALE" },
    });

    // Re-assign all affected staff to new version
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

    const newAssignments = passedAssignments.length > 0
      ? await tx.assignment.createMany({
          data: passedAssignments.map((a) => ({
            userId:       a.userId,
            sopId,
            sopVersionId: newVersion.id,
            assignedById: adminId,
            dueDate:      thirtyDaysFromNow,
            status:       "NOT_STARTED",
          })),
        })
      : { count: 0 };

    return {
      newVersion,
      staleCount:    staleResult.count,
      reassignCount: newAssignments.count,
    };
  });

  return {
    sopId,
    sopTitle:         sop.title,
    newVersionId:     result.newVersion.id,
    newVersionNumber: result.newVersion.versionNumber,
    staffMarkedStale: result.staleCount,
    newAssignments:   result.reassignCount,
    message: result.staleCount > 0
      ? `Version ${newVersionNumber} created. ${result.staleCount} staff marked for re-assessment.`
      : `Version ${newVersionNumber} created. No staff needed re-assignment.`,
  };
}

// ---------------------------------------------------------------------------
// GET VERSION HISTORY
// ---------------------------------------------------------------------------
export async function getVersionHistory(sopId: string) {
  const sop = await prisma.sOP.findUnique({
    where: { id: sopId },
    include: {
      versions: {
        orderBy: { versionNumber: "desc" },
        include: {
          _count: {
            select: {
              assignments: true,
              questions:   true,
            },
          },
        },
      },
    },
  });

  if (!sop) throw new SOPNotFoundError();

  return {
    sopId:           sop.id,
    title:           sop.title,
    activeVersionId: sop.activeVersionId,
    versions: sop.versions.map((v) => ({
      versionId:       v.id,
      versionNumber:   v.versionNumber,
      status:          v.status,
      createdAt:       v.createdAt,
      assignmentCount: v._count.assignments,
      questionCount:   v._count.questions,
      isActive:        v.id === sop.activeVersionId,
    })),
  };
}

// ---------------------------------------------------------------------------
// GET STALE ASSIGNMENTS FOR A USER
// ---------------------------------------------------------------------------
export async function getStaleAssignmentsForUser(userId: string) {
  const stale = await prisma.assignment.findMany({
    where: { userId, status: "STALE" },
    include: {
      sop:        { select: { title: true, category: true } },
      sopVersion: { select: { versionNumber: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return stale.map((a) => ({
    assignmentId: a.id,
    sopTitle:     a.sop.title,
    category:     a.sop.category,
    oldVersion:   a.sopVersion.versionNumber,
    message:      "This SOP has been updated. Please re-read and re-assess.",
  }));
}