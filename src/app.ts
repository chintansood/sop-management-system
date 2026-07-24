import "dotenv/config";
import express from "express";
import authRoutes from "./modules/auth/auth.routes";
import sopRoutes from "./modules/sops/sop.routes";
import assignmentRoutes from "./modules/assignments/assignment.routes";
import learningRoutes from "./modules/learning/learning.routes";
import assessmentRoutes from "./modules/assessments/assessment.routes";
import reportRoutes from "./modules/reports/reports.routes";

const app = express();
const PORT = 3000;
import cors from "cors"

// add right after const app = express()
app.use(cors({
  origin: [
    "http://localhost:3001",
    "http://localhost:3002",
    "https://sop-frontend-admin.vercel.app",
    "https://sop-frontend-staff.vercel.app",
    "https://sop-frontend-staff-henna.vercel.app",
    /\.vercel\.app$/,
  ],
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}))

app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "Backend is alive" });
});
app.use("/api/v1/reports", reportRoutes);

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/sops", sopRoutes);
app.use("/api/v1/assignments", assignmentRoutes);
app.use("/api/v1/learning", learningRoutes);
app.use("/api/v1/assessments", assessmentRoutes);

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