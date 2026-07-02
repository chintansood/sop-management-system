import { Request, Response, NextFunction } from "express";

/**
 * This is a function that RETURNS a middleware — that's why routes use
 * it like `authorize("ADMIN", "SUPER_ADMIN")` rather than just
 * `authorize`. The arguments customize which roles are allowed for that
 * specific route, while the actual middleware function (the part Express
 * calls per-request) is the inner function below.
 *
 * IMPORTANT: this must run AFTER `authenticate` in the middleware chain
 * — it reads req.user, which `authenticate` is what sets. Calling
 * authorize() on a route without authenticate() first would crash on
 * `req.user.role` being undefined.
 */
export function authorize(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      // Defensive check — should never actually happen if authenticate()
      // runs first, but fails loudly instead of silently if route
      // ordering is ever set up wrong.
      return res.status(401).json({ error: "Not authenticated" });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: "You do not have permission to perform this action",
      });
    }

    next();
  };
}