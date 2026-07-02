import { z } from "zod";

/**
 * Same philosophy as responseSchema.ts in the AI module: never trust
 * data coming from outside the process (there, an AI response — here,
 * an HTTP request body) until it's passed through a schema.
 *
 * Express 5 note: req.body is `undefined` if no body was sent or the
 * Content-Type wasn't set to JSON (unlike Express 4, which defaulted
 * to `{}`). Zod's .parse()/.safeParse() handles `undefined` input fine
 * — it'll just fail validation with a clear "required" error — so we
 * don't need a separate undefined-check before validating.
 */

export const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export type LoginInput = z.infer<typeof LoginSchema>;

// Only Admin/Super Admin create accounts (per your architecture doc —
// there's no public self-signup), so this schema is stricter than a
// typical public registration form: role and department are required,
// not left for the user to choose for themselves.
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