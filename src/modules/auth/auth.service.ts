import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { User } from "@prisma/client";
import { prisma } from "../../lib/db";

/**
 * ─────────────────────────────────────────────────────────────────────────
 * WHY ACCESS TOKEN AND REFRESH TOKEN ARE SEPARATE
 * ─────────────────────────────────────────────────────────────────────────
 * Access token: short-lived (15 min). Sent with every API request. If it
 * leaks (e.g. via a logged URL or browser extension bug), the damage
 * window is small because it expires quickly.
 *
 * Refresh token: long-lived (7 days). Used ONLY to get a new access
 * token when the old one expires — never sent to ordinary API routes.
 * This is what lets a user stay "logged in" for days without re-entering
 * their password, while still keeping the token that's actually exposed
 * on every request short-lived.
 * ─────────────────────────────────────────────────────────────────────────
 */

const ACCESS_TOKEN_SECRET = process.env.JWT_ACCESS_SECRET as string;
const REFRESH_TOKEN_SECRET = process.env.JWT_REFRESH_SECRET as string;

if (!ACCESS_TOKEN_SECRET || !REFRESH_TOKEN_SECRET) {
  // Fail loudly at startup, not silently at the first login attempt.
  // A missing secret is a deployment misconfiguration, not a user error.
  throw new Error(
    "JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be set in the environment."
  );
}

const ACCESS_TOKEN_EXPIRY = "15m";
const REFRESH_TOKEN_EXPIRY = "7d";

// What we encode inside the token. Deliberately minimal — only what's
// needed to make an authorization decision on every request, since the
// token's contents are visible to anyone who decodes it (it is NOT
// encrypted, only signed). Never put password hashes or other secrets here.
export interface TokenPayload {
  userId: string;
  role: string;
}

// ---------------------------------------------------------------------------
// Password hashing
// ---------------------------------------------------------------------------

export async function hashPassword(plainPassword: string): Promise<string> {
  const SALT_ROUNDS = 10;
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

export async function verifyPassword(
  plainPassword: string,
  passwordHash: string
): Promise<boolean> {
  return bcrypt.compare(plainPassword, passwordHash);
}

// ---------------------------------------------------------------------------
// Token issuance
// ---------------------------------------------------------------------------

export function issueAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, ACCESS_TOKEN_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRY,
  });
}

export function issueRefreshToken(payload: TokenPayload): string {
  return jwt.sign(payload, REFRESH_TOKEN_SECRET, {
    expiresIn: REFRESH_TOKEN_EXPIRY,
  });
}

// ---------------------------------------------------------------------------
// Token verification
// ---------------------------------------------------------------------------
// These throw on invalid/expired tokens (jwt.verify's native behavior) —
// the middleware that calls these is responsible for catching that and
// turning it into a 401 response, not these functions themselves.

export function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, ACCESS_TOKEN_SECRET) as TokenPayload;
}

export function verifyRefreshToken(token: string): TokenPayload {
  return jwt.verify(token, REFRESH_TOKEN_SECRET) as TokenPayload;
}

// ---------------------------------------------------------------------------
// Login flow
// ---------------------------------------------------------------------------

export interface LoginResult {
  user: Pick<User, "id" | "fullName" | "email" | "role">;
  accessToken: string;
  refreshToken: string;
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super("Invalid email or password");
    this.name = "InvalidCredentialsError";
  }
}

export class AccountDisabledError extends Error {
  constructor() {
    super("This account has been disabled");
    this.name = "AccountDisabledError";
  }
}

export async function login(
  email: string,
  plainPassword: string
): Promise<LoginResult> {
  const user = await prisma.user.findUnique({ where: { email } });

  // Deliberately the SAME error message whether the email doesn't exist
  // OR the password is wrong. Telling an attacker "that email isn't
  // registered" vs "wrong password" leaks which emails are valid
  // accounts — a real, well-known security mistake to avoid.
  if (!user) {
    throw new InvalidCredentialsError();
  }

  if (!user.isActive) {
    throw new AccountDisabledError();
  }

  const passwordMatches = await verifyPassword(plainPassword, user.passwordHash);
  if (!passwordMatches) {
    throw new InvalidCredentialsError();
  }

  const payload: TokenPayload = { userId: user.id, role: user.role };

  return {
    user: {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
    },
    accessToken: issueAccessToken(payload),
    refreshToken: issueRefreshToken(payload),
  };
}

// ---------------------------------------------------------------------------
// Refresh flow
// ---------------------------------------------------------------------------

export async function refreshAccessToken(refreshToken: string): Promise<string> {
  // If the token is invalid/expired, verifyRefreshToken throws —
  // the controller layer turns that into a 401.
  const payload = verifyRefreshToken(refreshToken);

  // Re-check the user still exists and is still active. Without this,
  // a 7-day-old refresh token would keep working even after an admin
  // disables the account — a real gap if skipped.
  const user = await prisma.user.findUnique({ where: { id: payload.userId } });
  if (!user || !user.isActive) {
    throw new InvalidCredentialsError();
  }

  return issueAccessToken({ userId: user.id, role: user.role });
}