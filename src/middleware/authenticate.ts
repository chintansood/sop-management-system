import { Request, Response, NextFunction } from "express";
import { verifyAccessToken, TokenPayload } from "../modules/auth/auth.service";

// Extends Express's Request type so `req.user` is recognized by
// TypeScript everywhere downstream, instead of needing `(req as any).user`.
declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

/**
 * Reads the Authorization header, expects: "Bearer <token>".
 * On success, attaches the decoded payload to req.user and calls next().
 * On failure, responds 401 directly — does NOT call next(err), because
 * "no valid token" isn't an unexpected server error, it's an expected,
 * normal outcome that deserves its own clean response.
 */
export function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or malformed Authorization header" });
  }

  const token = header.slice("Bearer ".length);

  try {
    const payload = verifyAccessToken(token);
    req.user = payload;
    next();
  } catch (err) {
    // Covers both expired tokens (TokenExpiredError) and tampered/
    // malformed tokens (JsonWebTokenError) — both mean the same thing
    // to the client: "your session isn't valid, log in again."
    return res.status(401).json({ error: "Invalid or expired access token" });
  }
}