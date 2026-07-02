import { Router } from "express";
import {
  loginHandler,
  refreshHandler,
  createUserHandler,
  logoutHandler,
} from "./auth.controller";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";

const router = Router();

router.post("/login", loginHandler);
router.post("/refresh", refreshHandler);

// Account creation is admin-only — there's no public registration
// endpoint, matching your architecture doc's "admin-created accounts,
// no public self-signup" decision. `authenticate` confirms the caller
// has a valid token; `authorize` confirms that token's role is allowed
// to create users.
router.post(
  "/users",
  authenticate,
  authorize("SUPER_ADMIN", "ADMIN"),
  createUserHandler
);

router.post("/logout", authenticate, logoutHandler);

export default router;