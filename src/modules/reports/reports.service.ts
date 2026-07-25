import { prisma } from "../../lib/db";

// ---------------------------------------------------------------------------
// 1. OVERVIEW — powers the 3 stat cards on the admin dashboard
// ---------------------------------------------------------------------------
export async function getOverview(adminId: string) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  // Get admin's school
  const admin = await prisma.user.findUnique({ where: { id: adminId }, select: { schoolName: true } })
  const schoolName = admin?.schoolName ?? "My School"

  // Get all user IDs in this school
  const schoolUsers = await prisma.user.findMany({ where: { schoolName }, select: { id: true } })
  const schoolUserIds = schoolUsers.map(u => u.id)

  const totalAssignments = await prisma.assignment.count({
    where: { status: { not: "STALE" }, userId: { in: schoolUserIds } },
  });

  const passedAssignments = await prisma.assignment.count({
    where: { status: "PASSED", userId: { in: schoolUserIds } },
  });

  const overdueAssignments = await prisma.assignment.count({
    where: {
      dueDate: { lt: now },
      status: { notIn: ["PASSED", "STALE"] },
      userId: { in: schoolUserIds },
    },
  });

  const passedThisMonth = await prisma.attempt.count({
    where: {
      passed: true,
      submittedAt: { gte: startOfMonth },
      assignment: { userId: { in: schoolUserIds } },
    },
  });

  const compliancePercentage =
    totalAssignments > 0
      ? Math.round((passedAssignments / totalAssignments) * 100)
      : 0;

  return {
    compliancePercentage,
    totalAssignments,
    passedAssignments,
    overdueAssignments,
    passedThisMonth,
  };
}

// ---------------------------------------------------------------------------
// 2. BY SOP — powers the compliance report table
// ---------------------------------------------------------------------------
export async function getComplianceBySOP() {
  const now = new Date();

  const sops = await prisma.sOP.findMany({
    include: {
      versions: {
        include: {
          assignments: {
            select: { status: true, dueDate: true },
          },
        },
      },
    },
  });

  return sops.map((sop) => {
    const allAssignments = sop.versions.flatMap((v) => v.assignments);
    const total   = allAssignments.length;
    const passed  = allAssignments.filter((a) => a.status === "PASSED").length;
    const overdue = allAssignments.filter(
      (a) => a.dueDate !== null && a.dueDate < now &&
      !["PASSED", "STALE"].includes(a.status)
    ).length;
    const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

    return {
      sopId:    sop.id,
      title:    sop.title,
      category: sop.category,
      total,
      passed,
      overdue,
      passRate,
    };
  });
}

// ---------------------------------------------------------------------------
// 3. BY DEPARTMENT — queries assignments directly, avoids User relation issues
// ---------------------------------------------------------------------------
export async function getComplianceByDepartment() {
  const now = new Date();

  const departments = await prisma.department.findMany();

  const results = await Promise.all(
    departments.map(async (dept) => {
      // Get all user IDs in this department
      const users = await prisma.user.findMany({
        where: { departmentId: dept.id },
        select: { id: true },
      });

      const userIds = users.map((u) => u.id);

      if (userIds.length === 0) {
        return {
          departmentId:   dept.id,
          departmentName: dept.name,
          staffCount:     0,
          total:          0,
          passed:         0,
          overdue:        0,
          passRate:       0,
        };
      }

      // Query assignments directly by userId
      const allAssignments = await prisma.assignment.findMany({
        where: { userId: { in: userIds } },
        select: { status: true, dueDate: true },
      });

      const total   = allAssignments.length;
      const passed  = allAssignments.filter((a) => a.status === "PASSED").length;
      const overdue = allAssignments.filter(
        (a) => a.dueDate !== null && a.dueDate < now &&
        !["PASSED", "STALE"].includes(a.status)
      ).length;
      const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

      return {
        departmentId:   dept.id,
        departmentName: dept.name,
        staffCount:     users.length,
        total,
        passed,
        overdue,
        passRate,
      };
    })
  );

  return results;
}

// ---------------------------------------------------------------------------
// 4. INDIVIDUAL STAFF — queries assignments directly by userId
// ---------------------------------------------------------------------------
export async function getStaffCompliance(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id:       true,
      fullName: true,
      email:    true,
      role:     true,
    },
  });

  if (!user) throw new Error("Staff member not found");

  const now = new Date();

  // Query assignments directly
  const assignments = await prisma.assignment.findMany({
    where: { userId },
    include: {
      sop: { select: { title: true, category: true } },
      attempts: {
        orderBy: { attemptNumber: "asc" },
        select: {
          id:            true,
          attemptNumber: true,
          score:         true,
          passed:        true,
          startedAt:     true,
          submittedAt:   true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const totalAssigned = assignments.length;
  const totalPassed   = assignments.filter((a) => a.status === "PASSED").length;
  const totalOverdue  = assignments.filter(
    (a) => a.dueDate !== null && a.dueDate < now &&
    !["PASSED", "STALE"].includes(a.status)
  ).length;

  const compliancePercentage =
    totalAssigned > 0 ? Math.round((totalPassed / totalAssigned) * 100) : 0;

  return {
    userId:   user.id,
    fullName: user.fullName,
    email:    user.email,
    role:     user.role,
    compliancePercentage,
    totalAssigned,
    totalPassed,
    totalOverdue,
    assignments: assignments.map((a) => ({
      assignmentId: a.id,
      sopTitle:     a.sop.title,
      category:     a.sop.category,
      status:       a.status,
      dueDate:      a.dueDate,
      attempts:     a.attempts,
    })),
  };
}

// ---------------------------------------------------------------------------
// 5. OVERDUE LIST — all overdue assignments with staff details
// ---------------------------------------------------------------------------
export async function getOverdueAssignments() {
  const now = new Date();

  const overdue = await prisma.assignment.findMany({
    where: {
      dueDate: { lt: now },
      status:  { notIn: ["PASSED", "STALE"] },
    },
    include: {
      user: { select: { id: true, fullName: true, email: true, role: true } },
      sop:  { select: { title: true, category: true } },
    },
    orderBy: { dueDate: "asc" },
  });

  return overdue.map((a) => ({
    assignmentId: a.id,
    staffName:    a.user.fullName,
    staffEmail:   a.user.email,
    staffRole:    a.user.role,
    sopTitle:     a.sop.title,
    category:     a.sop.category,
    dueDate:      a.dueDate,
    status:       a.status,
    daysOverdue:  a.dueDate
      ? Math.floor((now.getTime() - a.dueDate.getTime()) / (1000 * 60 * 60 * 24))
      : 0,
  }));
}

// ---------------------------------------------------------------------------
// 6. GAP ANALYSIS — which questions staff get wrong most often
// ---------------------------------------------------------------------------
export async function getGapAnalysis(sopVersionId: string) {
  const wrongAnswers = await prisma.attemptAnswer.groupBy({
    by:      ["questionId"],
    where:   { isCorrect: false },
    _count:  { questionId: true },
    orderBy: { _count: { questionId: "desc" } },
    take: 5,
  });

  if (wrongAnswers.length === 0) {
    return { message: "No assessment data yet", weakAreas: [] };
  }

  const questions = await prisma.question.findMany({
    where: {
      id:           { in: wrongAnswers.map((w) => w.questionId) },
      sopVersionId,
    },
    select: { id: true, text: true, difficulty: true },
  });

  return {
    message:   "Questions with highest failure rate across all staff",
    weakAreas: wrongAnswers.map((w) => {
      const q = questions.find((q) => q.id === w.questionId);
      return {
        questionId:   w.questionId,
        questionText: q?.text ?? "Question not found",
        difficulty:   q?.difficulty ?? "UNKNOWN",
        timesWrong:   w._count.questionId,
      };
    }),
  };
}
