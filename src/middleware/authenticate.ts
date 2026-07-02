import { Request, Response, NextFunction } from "express";
import { verifyAccessToken, TokenPayload } from "../modules/auth/auth.service";

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}


 
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
    
    return res.status(401).json({ error: "Invalid or expired access token" });
  }
}