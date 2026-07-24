import multer from "multer";
import path from "path";
import fs from "fs";



const UPLOAD_DIR = path.join(process.cwd(), "uploads");


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


const fileFilter = (
  _req: Express.Request,
  file: Express.Request & { mimetype: string; originalname: string },
  cb: multer.FileFilterCallback
) => {
  const allowedMimeTypes = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ];


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


export const sopUpload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
    
  },
});

export const UPLOAD_DIR_PATH = UPLOAD_DIR;