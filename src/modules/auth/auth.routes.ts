import { Router } from "express";
import {
  loginHandler,
  refreshHandler,
  createUserHandler,
  logoutHandler,
  getAllUsersHandler,
  registerHandler,
  approveUserHandler,
  deactivateUserHandler,
  updateSchoolNameHandler,
  getPendingUsersHandler,
  getMeHandler,
} from "./auth.controller";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";

const router = Router();

router.post("/login", loginHandler);
router.post("/refresh", refreshHandler);

router.get("/users", authenticate, authorize("SUPER_ADMIN", "ADMIN"), getAllUsersHandler)
router.get("/users/pending", authenticate, authorize("SUPER_ADMIN", "ADMIN"), getPendingUsersHandler)


router.post(
  "/users",
  authenticate,
  authorize("SUPER_ADMIN", "ADMIN"),
  createUserHandler
);

router.post("/logout", authenticate, logoutHandler);

// Public — staff self signup
router.post("/register", registerHandler)

// Admin — approve or deactivate users
router.patch("/:userId/approve",    authenticate, authorize("SUPER_ADMIN", "ADMIN"), approveUserHandler)
router.patch("/:userId/deactivate", authenticate, authorize("SUPER_ADMIN", "ADMIN"), deactivateUserHandler)

router.patch("/school-name", authenticate, updateSchoolNameHandler)

router.get("/me", authenticate, getMeHandler)

export default router;