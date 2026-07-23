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
import { getAllUsersHandler } from "./auth.controller"

router.get("/users", authenticate, authorize("SUPER_ADMIN", "ADMIN"), getAllUsersHandler)


router.post(
  "/users",
  authenticate,
  authorize("SUPER_ADMIN", "ADMIN"),
  createUserHandler
);

router.post("/logout", authenticate, logoutHandler);

export default router;