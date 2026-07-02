import { z } from "zod";


export const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export type LoginInput = z.infer<typeof LoginSchema>;

export const CreateUserSchema = z.object({
  fullName: z.string().trim().min(2, "Full name is too short"),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
  role: z.enum([
    "SUPER_ADMIN",
    "ADMIN",
    "DEPT_HEAD",
    "TEACHING_STAFF",
    "NON_TEACHING_STAFF",
  ]),
  staffType: z.enum(["TEACHING", "NON_TEACHING"]).nullable().optional(),
  departmentId: z.string().uuid().nullable().optional(),
});

export type CreateUserInput = z.infer<typeof CreateUserSchema>;

export const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required"),
});

export type RefreshTokenInput = z.infer<typeof RefreshTokenSchema>;