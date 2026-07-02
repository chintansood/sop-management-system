import { Request, Response } from "express";
import path from "path";
import { prisma } from "../../lib/db";
import { CreateSOPSchema, ReviewQuestionSchema, ListQuestionsSchema } from "./sop.validation";
import {
  generateQuestionsForSOPVersion,
  SOPVersionNotFoundError,
  TextExtractionError,
  AIGenerationError,
} from "../ai-questions/ai.service";

// ---------------------------------------------------------------------------
// Upload a new SOP (creates SOP + SOPVersion in one transaction)
// ---------------------------------------------------------------------------

export async function uploadSOPHandler(req: Request, res: Response) {
  // req.file is set by multer middleware (registered on the route)
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const parsed = CreateSOPSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      details: parsed.error.issues.map((i: { message: string }) => i.message),
    });
  }

  const { title, category, applicableTo } = parsed.data;

  // Store the file path relative to the project root — not the absolute
  // OS path — so the path still works if the project moves directories
  const fileUrl = path.join("uploads", req.file.filename);

  // Use a transaction so both the SOP row and the SOPVersion row are
  // created atomically — if either fails, neither is saved.
  const result = await prisma.$transaction(async (tx) => {
    const sop = await tx.sOP.create({
      data: {
        title,
        category,
        applicableTo,
        createdById: req.user!.userId,
      },
    });

    const sopVersion = await tx.sOPVersion.create({
      data: {
        sopId: sop.id,
        versionNumber: 1,
        fileUrl,
        uploadedById: req.user!.userId,
        status: "DRAFT",
      },
    });

    return { sop, sopVersion };
  });

  return res.status(201).json({
    message: "SOP uploaded successfully",
    sopId: result.sop.id,
    sopVersionId: result.sopVersion.id,
    versionNumber: result.sopVersion.versionNumber,
    status: result.sopVersion.status,
  });
}

// ---------------------------------------------------------------------------
// Upload a new version of an existing SOP
// ---------------------------------------------------------------------------

export async function uploadSOPVersionHandler(req: Request, res: Response) {
  const { sopId } = req.params;

  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const sop = await prisma.sOP.findUnique({ where: { id: String(sopId) } });
  if (!sop) {
    return res.status(404).json({ error: "SOP not found" });
  }

  // Find the current highest version number for this SOP
  const latestVersion = await prisma.sOPVersion.findFirst({
    where: { sopId: String(sopId) },
    orderBy: { versionNumber: "desc" },
  });

  const nextVersionNumber = (latestVersion?.versionNumber ?? 0) + 1;
  const fileUrl = path.join("uploads", req.file.filename);

  const sopVersion = await prisma.sOPVersion.create({
    data: {
      sopId: String(sopId),
      versionNumber: nextVersionNumber,
      fileUrl,
      uploadedById: req.user!.userId,
      status: "DRAFT",
    },
  });

  return res.status(201).json({
    message: `Version ${nextVersionNumber} uploaded successfully`,
    sopVersionId: sopVersion.id,
    versionNumber: sopVersion.versionNumber,
    status: sopVersion.status,
  });
}

// ---------------------------------------------------------------------------
// Trigger AI question generation for a SOP version
// ---------------------------------------------------------------------------

export async function generateQuestionsHandler(req: Request, res: Response) {
  const sopVersionId = String(req.params.sopVersionId);
  const questionCount = parseInt(req.query.count as string) || 10;

  // Cap at 20 to avoid runaway token usage
  const clampedCount = Math.min(Math.max(questionCount, 3), 20);

  try {
    const result = await generateQuestionsForSOPVersion(
      sopVersionId,
      clampedCount
    );

    return res.status(200).json({
      message: `Generated ${result.questionsCreated} draft questions successfully`,
      ...result,
    });
  } catch (err) {
    if (err instanceof SOPVersionNotFoundError) {
      return res.status(404).json({ error: err.message });
    }
    if (err instanceof TextExtractionError) {
      return res.status(422).json({
        error: "Could not extract text from this document",
        detail: err.message,
      });
    }
    if (err instanceof AIGenerationError) {
      return res.status(502).json({
        error: "AI question generation failed",
        detail: err.message,
      });
    }
    throw err; // unexpected — let Express 5 error handler catch it
  }
}

// ---------------------------------------------------------------------------
// List questions for a SOP version (with optional status filter)
// ---------------------------------------------------------------------------

export async function listQuestionsHandler(req: Request, res: Response) {
  const { sopVersionId } = req.params;
  const parsed = ListQuestionsSchema.safeParse(req.query);

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query parameters" });
  }

  const { status } = parsed.data;

  const questions = await prisma.question.findMany({
    where: {
      sopVersionId: String(sopVersionId),
      ...(status !== "ALL" ? { status } : {}),
    },
    include: {
      options: true,
    },
    orderBy: { createdAt: "asc" },
  });

  return res.status(200).json({ questions });
}

// ---------------------------------------------------------------------------
// Review a single question: approve (with optional edits) or reject
// ---------------------------------------------------------------------------

export async function reviewQuestionHandler(req: Request, res: Response) {
  const { questionId } = req.params;
  const parsed = ReviewQuestionSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      details: parsed.error.issues.map((i: { message: string }) => i.message),
    });
  }

  const { action, text, explanation, options, correctOptionIndex } = parsed.data;

  const question = await prisma.question.findUnique({
    where: { id: String(questionId) },
    include: { options: true },
  });

  if (!question) {
    return res.status(404).json({ error: "Question not found" });
  }

  if (question.status !== "DRAFT") {
    return res.status(409).json({
      error: `Question is already ${question.status.toLowerCase()} — only DRAFT questions can be reviewed`,
    });
  }

  if (action === "REJECT") {
    const updated = await prisma.question.update({
  where: { id: String(questionId) },
  data: { status: "REJECTED" },
});
    return res.status(200).json({ message: "Question rejected", question: updated });
  }

  // APPROVE — with optional edits
  // If admin edits the text/options, source becomes AI_EDITED
  const hasEdits = text || explanation || options || correctOptionIndex !== undefined;

  const updated = await prisma.question.update({
   where: { id: String(questionId) },
    data: {
      status: "APPROVED",
      source: hasEdits ? "AI_EDITED" : question.source,
      ...(text ? { text } : {}),
      ...(explanation ? { explanation } : {}),
    },
  });

  // Update options if provided
  if (options && correctOptionIndex !== undefined) {
    // Delete existing options and replace with new ones
    await prisma.attemptOption.deleteMany({ where: { questionId: String(questionId) } });
    await prisma.attemptOption.createMany({
      data: options.map((optionText, idx) => ({
        text: optionText,
        isCorrect: idx === correctOptionIndex,
        questionId: String(questionId),
      })),
    });
  }

  // Check if all questions for this SOP version are now approved/rejected
  // and update the version status accordingly
  const sopVersionId = question.sopVersionId;
  const remainingDrafts = await prisma.question.count({
    where: { sopVersionId, status: "DRAFT" },
  });

  if (remainingDrafts === 0) {
    const approvedCount = await prisma.question.count({
      where: { sopVersionId, status: "APPROVED" },
    });

    if (approvedCount > 0) {
      await prisma.sOPVersion.update({
        where: { id: sopVersionId },
        data: { status: "QUESTIONS_APPROVED" },
      });
    }
  }

  return res.status(200).json({
    message: `Question ${action === "APPROVE" ? "approved" : "rejected"}`,
    question: updated,
  });
}