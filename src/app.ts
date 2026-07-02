import "dotenv/config";
import express from "express";
import authRoutes from "./modules/auth/auth.routes";
import sopRoutes from "./modules/sops/sop.routes";

const app = express();
const PORT = 3000;

app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "Backend is alive" });
});

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/sops", sopRoutes);

// Central error handler — must be last
app.use(
  (err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("Unhandled error:", err);
    res.status(500).json({ error: "Something went wrong on our end" });
  }
);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});