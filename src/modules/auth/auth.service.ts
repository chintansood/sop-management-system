import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { User } from "@prisma/client";
import { prisma } from "../../lib/db";



const ACCESS_TOKEN_SECRET = process.env.JWT_ACCESS_SECRET as string;
const REFRESH_TOKEN_SECRET = process.env.JWT_REFRESH_SECRET as string;

if (!ACCESS_TOKEN_SECRET || !REFRESH_TOKEN_SECRET) {
  // Fail loudly at startup, not silently at the first login attempt.
  // A missing secret is a deployment misconfiguration, not a user error.
  throw new Error(
    "JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be set in the environment."
  );
}

const ACCESS_TOKEN_EXPIRY = "2h";
const REFRESH_TOKEN_EXPIRY = "7d";

// What we encode inside the token. Deliberately minimal — only what's
// needed to make an authorization decision on every request, since the
// token's contents are visible to anyone who decodes it (it is NOT
// encrypted, only signed). Never put password hashes or other secrets here.
export interface TokenPayload {
  userId: string;
  role: string;
}


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
  user: Pick<User, "id" | "fullName" | "email" | "role" | "schoolName">;
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
      schoolName: user.schoolName,
    },
    accessToken: issueAccessToken(payload),
    refreshToken: issueRefreshToken(payload),
  };
}

// ---------------------------------------------------------------------------
// Refresh flow
// ---------------------------------------------------------------------------

export async function refreshAccessToken(refreshToken: string): Promise<string> {

  const payload = verifyRefreshToken(refreshToken);


  const user = await prisma.user.findUnique({ where: { id: payload.userId } });
  if (!user || !user.isActive) {
    throw new InvalidCredentialsError();
  }

  return issueAccessToken({ userId: user.id, role: user.role });
}
// ---------------------------------------------------------------------------
// REGISTER — staff self signup (account inactive until admin approves)
// ---------------------------------------------------------------------------
export async function register(input: {
  fullName: string
  email: string
  password: string
  role: string
}) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } })
  if (existing) throw new Error("Email already registered")

  const passwordHash = await hashPassword(input.password)

  const user = await prisma.user.create({
    data: {
      fullName:     input.fullName,
      email:        input.email,
      passwordHash,
      role:         input.role as any,
      isActive:     false, // must be approved by admin
    },
    select: { id: true, fullName: true, email: true, role: true, isActive: true },
  })

  return user
}

// ---------------------------------------------------------------------------
// APPROVE USER — admin activates a pending account
// ---------------------------------------------------------------------------
export async function approveUser(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw new Error("User not found")

  return prisma.user.update({
    where: { id: userId },
    data:  { isActive: true },
    select: { id: true, fullName: true, email: true, role: true, isActive: true },
  })
}

// ---------------------------------------------------------------------------
// DEACTIVATE USER — admin deactivates an account
// ---------------------------------------------------------------------------
export async function deactivateUser(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw new Error("User not found")

  return prisma.user.update({
    where: { id: userId },
    data:  { isActive: false },
    select: { id: true, fullName: true, email: true, role: true, isActive: true },
  })
}

// ---------------------------------------------------------------------------
// UPDATE SCHOOL NAME
// ---------------------------------------------------------------------------
export async function updateSchoolName(userId: string, schoolName: string) {
  return prisma.user.update({
    where: { id: userId },
    data: { schoolName },
    select: { id: true, schoolName: true },
  })
}
