import { GoogleGenerativeAI } from "@google/generative-ai";
import { prisma } from "../../lib/db";
import { extractTextFromFile } from "../sops/sop.extraction";
import { buildSystemInstruction, buildUserPrompt } from "./promptBuilder";
import { validateAIResponse, AIQuestion } from "./responseSchema";

/**
 * ─────────────────────────────────────────────────────────────────────────
 * THE ORCHESTRATOR
 * ─────────────────────────────────────────────────────────────────────────
 * This file ties together every piece we've built:
 *
 *   1. Get the SOP version from DB (has fileUrl and maybe cached text)
 *   2. Extract text from the file (if not already cached)
 *   3. Cache the extracted text on the SOPVersion row
 *   4. Build the prompt
 *   5. Call Gemini API
 *   6. Validate the response (Zod + content checks)
 *   7. Retry once if validation fails
 *   8. Save valid questions as DRAFT rows in the DB
 *   9. Return the saved questions to the caller (controller)
 *
 * Nothing else in the app calls Gemini directly — only this file.
 * ─────────────────────────────────────────────────────────────────────────
 */

if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY must be set in environment variables");
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// gpt-4o-mini equivalent for Gemini — fast, cheap, good at structured tasks
const MODEL_NAME = "gemini-2.5-flash";
const DEFAULT_QUESTION_COUNT = 10;
const MAX_RETRIES = 2;

// ---------------------------------------------------------------------------
// Error types the controller can inspect
// ---------------------------------------------------------------------------

export class SOPVersionNotFoundError extends Error {
  constructor(id: string) {
    super(`SOP version ${id} not found`);
    this.name = "SOPVersionNotFoundError";
  }
}

export class TextExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TextExtractionError";
  }
}

export class AIGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIGenerationError";
  }
}

// ---------------------------------------------------------------------------
// The single function controllers call
// ---------------------------------------------------------------------------

export interface GenerateQuestionsResult {
  questionsCreated: number;
  sopVersionId: string;
  questions: Array<{
    id: string;
    text: string;
    difficulty: string;
    status: string;
  }>;
}

export async function generateQuestionsForSOPVersion(
  sopVersionId: string,
  questionCount: number = DEFAULT_QUESTION_COUNT
): Promise<GenerateQuestionsResult> {

  // ── Step 1: Fetch the SOP version ────────────────────────────────────
  const sopVersion = await prisma.sOPVersion.findUnique({
    where: { id: sopVersionId },
    include: { sop: true },
  });

  if (!sopVersion) {
    throw new SOPVersionNotFoundError(sopVersionId);
  }

  // ── Step 2 & 3: Extract text (or use cached version) ─────────────────
  let extractedText = sopVersion.extractedText;

  if (!extractedText) {
    const extractionResult = await extractTextFromFile(sopVersion.fileUrl);

    if (!extractionResult.ok) {
      throw new TextExtractionError(extractionResult.message);
    }

    extractedText = extractionResult.text;

    // Cache it so re-generating questions doesn't re-parse the file
    await prisma.sOPVersion.update({
      where: { id: sopVersionId },
      data: { extractedText },
    });
  }

  // ── Step 4: Build the prompt ──────────────────────────────────────────
  const systemInstruction = buildSystemInstruction();
  const userPrompt = buildUserPrompt({
    sopTitle: sopVersion.sop.title,
    sopId: sopVersion.sop.id,
    extractedText,
    questionCount,
  });

  // ── Steps 5-7: Call Gemini, validate, retry if needed ────────────────
  const validatedQuestions = await callGeminiWithRetry(
    systemInstruction,
    userPrompt,
    questionCount
  );

  // ── Step 8: Save as DRAFT questions ──────────────────────────────────
  // Why createMany instead of individual creates?
  // Wrapping 10 inserts in one DB call is significantly faster than
  // 10 separate round-trips to Postgres.
  // Note: Prisma's createMany doesn't return the created records on all
  // databases — we follow up with a findMany to get the IDs.
  await prisma.question.createMany({
    data: validatedQuestions.map((q) => ({
      text: q.questionText,
      difficulty: q.difficulty,
      source: "AI_GENERATED",
      status: "DRAFT",
      explanation: q.explanation,
      sopVersionId,
    })),
  });

  // Fetch the questions we just created so we can return them with IDs
  // Options and correctOptionIndex need to be stored separately
  // We'll handle AttemptOption creation after fetching the questions
  const createdQuestions = await prisma.question.findMany({
    where: {
      sopVersionId,
      status: "DRAFT",
      source: "AI_GENERATED",
    },
    orderBy: { createdAt: "desc" },
    take: questionCount,
  });

  // Save the options for each question
for (let i = 0; i < createdQuestions.length; i++) {
  const question = createdQuestions[i];
  const aiQuestion = validatedQuestions[i];

  if (!question || !aiQuestion) continue;

  await prisma.attemptOption.createMany({
    data: aiQuestion.options.map((optionText, optionIndex) => ({
      text: optionText,
      isCorrect: optionIndex === aiQuestion.correctOptionIndex,
      questionId: question.id,
    })),
  });
}

  // ── Step 9: Update SOPVersion status ─────────────────────────────────
  await prisma.sOPVersion.update({
    where: { id: sopVersionId },
    data: { status: "QUESTIONS_GENERATED" },
  });

  return {
    questionsCreated: createdQuestions.length,
    sopVersionId,
    questions: createdQuestions.map((q) => ({
      id: q.id,
      text: q.text,
      difficulty: q.difficulty,
      status: q.status,
    })),
  };
}

// ---------------------------------------------------------------------------
// Gemini API call with retry logic
// ---------------------------------------------------------------------------

async function callGeminiWithRetry(
  systemInstruction: string,
  userPrompt: string,
  questionCount: number
): Promise<AIQuestion[]> {
  let lastErrors: string[] = [];

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const model = genAI.getGenerativeModel({
        model: MODEL_NAME,
        systemInstruction,
        generationConfig: {
          // Tells Gemini to always return parseable JSON
          // Equivalent to OpenAI's response_format: { type: "json_object" }
          responseMimeType: "application/json",

          // Low temperature = less creative, more literal and consistent.
          // We want the model to stick closely to the SOP text, not
          // improvise — so creativity is the enemy here.
          temperature: 0.3,
        },
      });

      const result = await model.generateContent(userPrompt);
      const rawText = result.response.text();

      // Parse the JSON string into an object
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        lastErrors = [`Attempt ${attempt}: Gemini returned non-JSON response`];
        continue; // retry
      }

      // Validate the parsed object
      const validation = validateAIResponse(parsed);

      if (!validation.success) {
        lastErrors = validation.errors;
        console.warn(
          `AI generation attempt ${attempt} failed validation:`,
          validation.errors
        );
        continue; // retry
      }

      // Ensure we got the right number of questions
      // (Gemini might return fewer if the SOP is short)
      if (validation.data.length < questionCount) {
        console.warn(
          `Gemini returned ${validation.data.length} questions, expected ${questionCount}. Using what we got.`
        );
      }

      return validation.data;

    } catch (err) {
      lastErrors = [`Attempt ${attempt}: ${(err as Error).message}`];
      console.error(`Gemini API call failed on attempt ${attempt}:`, err);
    }
  }

  // All retries exhausted
  throw new AIGenerationError(
    `Failed to generate valid questions after ${MAX_RETRIES} attempts. ` +
    `Last errors: ${lastErrors.join("; ")}`
  );
}