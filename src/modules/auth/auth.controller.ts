import { Request, Response } from "express";
import {
  LoginSchema,
  CreateUserSchema,
  RefreshTokenSchema,
} from "./auth.validation";
import {
  login,
  refreshAccessToken,
  hashPassword,
  InvalidCredentialsError,
  AccountDisabledError,
} from "./auth.service";
import { prisma } from "../../lib/db";

/**
 * Express 5 note: these are plain async functions with NO try/catch.
 * If login() throws (InvalidCredentialsError, or a Prisma error, or
 * anything else), Express 5 automatically forwards it to the error
 * handling middleware (registered centrally in app.ts) — we don't need
 * to call next(err) manually here. That middleware is what actually
 * decides "InvalidCredentialsError -> 401" vs "everything else -> 500".
 */

export async function loginHandler(req: Request, res: Response) {
  const parsed = LoginSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      details: parsed.error.issues.map((i: { message: string }) => i.message),
    });
  }

  try {
    const result = await login(parsed.data.email, parsed.data.password);
    return res.status(200).json(result);
  } catch (err) {
    // These two are "expected" failures with a specific, safe-to-show
    // message — everything else falls through to the generic error
    // middleware, which won't leak internal details to the client.
    if (err instanceof InvalidCredentialsError) {
      return res.status(401).json({ error: err.message });
    }
    if (err instanceof AccountDisabledError) {
      return res.status(403).json({ error: err.message });
    }
    throw err; // re-thrown -> Express 5 forwards to error middleware
  }
}

export async function refreshHandler(req: Request, res: Response) {
  const parsed = RefreshTokenSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      details: parsed.error.issues.map((i: { message: string }) => i.message),
    });
  }

  try {
    const accessToken = await refreshAccessToken(parsed.data.refreshToken);
    return res.status(200).json({ accessToken });
  } catch (err) {
    // Covers both "refresh token invalid/expired" (thrown by jwt.verify
    // inside the service) and "user no longer active" — both should
    // look the same to the client: "please log in again."
    return res.status(401).json({ error: "Invalid or expired refresh token" });
  }
}

export async function createUserHandler(req: Request, res: Response) {
  const parsed = CreateUserSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      details: parsed.error.issues.map((i: { message: string }) => i.message),
    });
  }

  const { fullName, email, password, role, staffType, departmentId } =
    parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: "A user with this email already exists" });
  }

  const passwordHash = await hashPassword(password);

  const user = await prisma.user.create({
    data: {
      fullName,
      email,
      passwordHash,
      role,
      staffType: staffType ?? null,
      departmentId: departmentId ?? null,
    },
  });

  // Never return passwordHash in any API response, even on creation.
  return res.status(201).json({
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
  });
}

export async function logoutHandler(req: Request, res: Response) {
  // Stateless JWT logout: there's no server-side session to destroy.
  // The actual "logout" work happens client-side (discarding the stored
  // tokens). This endpoint exists mainly for API symmetry and as a place
  // to add server-side token revocation later if you ever need it
  // (e.g. a blocklist table for refresh tokens) — noted as a fast-follow,
  // not needed for the MVP per your architecture doc.
  return res.status(200).json({ message: "Logged out" });
}