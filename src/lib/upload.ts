import multer from "multer";
import path from "path";
import fs from "fs";

/**
 * ─────────────────────────────────────────────────────────────────────────
 * WHY A DEDICATED UPLOAD CONFIG FILE
 * ─────────────────────────────────────────────────────────────────────────
 * Multer needs to know three things before it accepts any file:
 *   1. WHERE to store it (disk path)
 *   2. WHAT to name it (to avoid collisions between files with same name)
 *   3. WHETHER to accept it at all (type and size checks)
 *
 * All three live here, isolated from route and business logic — so if you
 * ever swap local disk for S3, you only change this one file.
 * ─────────────────────────────────────────────────────────────────────────
 */

const UPLOAD_DIR = path.join(process.cwd(), "uploads");

// Ensure the uploads directory exists at startup.
// process.cwd() = the directory you run the server from, which is
// always backend/ — so this resolves to backend/uploads/.
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ---------------------------------------------------------------------------
// Storage: where files land on disk and what they're named
// ---------------------------------------------------------------------------
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },

  filename: (_req, file, cb) => {
    // Why not just keep the original filename?
    // Two admins could upload files named "SOP.pdf" at the same time,
    // or the same file could be re-uploaded as a new version — both
    // cases would silently overwrite the previous file.
    // Prepending a timestamp + random suffix makes every stored
    // filename unique, guaranteed.
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uniqueSuffix}${ext}`);
  },
});

// ---------------------------------------------------------------------------
// File filter: only accept PDF and DOCX
// ---------------------------------------------------------------------------
const fileFilter = (
  _req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  const allowedMimeTypes = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ];

  // Why check mimetype AND extension?
  // A malicious user could rename a .exe to .pdf and trick a
  // mimetype-only check. Checking both provides defense in depth —
  // both must pass for the file to be accepted.
  const allowedExtensions = [".pdf", ".docx"];
  const ext = path.extname(file.originalname).toLowerCase();

  if (
    allowedMimeTypes.includes(file.mimetype) &&
    allowedExtensions.includes(ext)
  ) {
    cb(null, true); // accept
  } else {
    cb(
      new Error(
        `Invalid file type. Only PDF and DOCX files are accepted. Got: ${file.mimetype}`
      )
    );
  }
};

// ---------------------------------------------------------------------------
// The actual multer instance used by route handlers
// ---------------------------------------------------------------------------
export const sopUpload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
    // Why 10MB? A typical SOP document is 100KB-2MB.
    // 10MB gives generous headroom for image-heavy documents
    // while blocking truly large files that would slow text
    // extraction significantly.
  },
});

export const UPLOAD_DIR_PATH = UPLOAD_DIR;