import { z } from "zod";

/**
 * Assignments can be created in three ways:
 *   1. Assign to specific users by their IDs
 *   2. Assign to an entire department
 *   3. Assign to a role (e.g. all TEACHING_STAFF)
 *
 * All three use the same endpoint — the controller figures out
 * which users to create Assignment rows for based on which field
 * is provided.
 */

export const CreateAssignmentSchema = z
  .object({
    sopId: z.string().uuid("Invalid SOP ID"),
    dueDate: z.string().datetime().optional(),

    // Target: one of these three must be provided
    userIds: z.array(z.string().uuid()).min(1).optional(),
    departmentId: z.string().uuid().optional(),
    role: z
      .enum([
        "TEACHING_STAFF",
        "NON_TEACHING_STAFF",
        "DEPT_HEAD",
        "ADMIN",
        "SUPER_ADMIN",
      ])
      .optional(),
  })
  .refine(
    (data) =>
      data.userIds !== undefined ||
      data.departmentId !== undefined ||
      data.role !== undefined,
    {
      message:
        "At least one of userIds, departmentId, or role must be provided",
    }
  );

export type CreateAssignmentInput = z.infer<typeof CreateAssignmentSchema>;