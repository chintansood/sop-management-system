import fs from "fs";
import path from "path";


/**
 * ─────────────────────────────────────────────────────────────────────────
 * WHY TEXT EXTRACTION IS ITS OWN FILE
 * ─────────────────────────────────────────────────────────────────────────
 * The AI service needs clean text as input. But how you get that text
 * depends entirely on the file format — PDF and DOCX have completely
 * different internal structures and need different libraries.
 *
 * Keeping extraction isolated means:
 *   - ai.service.ts doesn't need to know or care which format it received
 *   - If you add PPTX or TXT support later, you add it here only
 *   - The quality-check logic (is this too short to be real text?)
 *     lives in one place, not scattered through the AI pipeline
 * ─────────────────────────────────────────────────────────────────────────
 */

// ---------------------------------------------------------------------------
// Extraction result types
// ---------------------------------------------------------------------------

export interface ExtractionSuccess {
  ok: true;
  text: string;
  pageCount?: number;
}

export interface ExtractionFailure {
  ok: false;
  reason: "unsupported_format" | "low_text_density" | "extraction_error";
  message: string;
}

export type ExtractionResult = ExtractionSuccess | ExtractionFailure;

// ---------------------------------------------------------------------------
// Quality guard
// ---------------------------------------------------------------------------
// This is the scanned-PDF detection we discussed in the architecture doc.
// If a file has very little text relative to its size, it's likely a
// scanned image — extraction "succeeded" but produced garbage.
//
// Threshold: fewer than 50 characters per page is suspiciously low
// for a real SOP document. A single paragraph is ~300-500 characters.
// ---------------------------------------------------------------------------

function isTextDensitySufficient(
  text: string,
  pageCount: number = 1
): boolean {
  const CHARS_PER_PAGE_MINIMUM = 50;
  return text.length >= pageCount * CHARS_PER_PAGE_MINIMUM;
}

// ---------------------------------------------------------------------------
// PDF extraction
// ---------------------------------------------------------------------------

async function extractFromPdf(filePath: string): Promise<ExtractionResult> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PDFParse } = require("pdf-parse");
    const dataBuffer = fs.readFileSync(filePath);

    const parser = new PDFParse({ data: dataBuffer, verbosity: 0 });
    await parser.load(dataBuffer);

    const textResult = await parser.getText();
    const infoResult = await parser.getInfo();

    const text = (textResult.text as string).trim();
    const pageCount = infoResult.total as number;

    if (!isTextDensitySufficient(text, pageCount)) {
      return {
        ok: false,
        reason: "low_text_density",
        message:
          `This PDF appears to be a scanned image (extracted only ${text.length} characters ` +
          `across ${pageCount} pages). AI question generation requires selectable text. ` +
          `Please use a text-based PDF or contact your developer about OCR support.`,
      };
    }

    return { ok: true, text, pageCount };
  } catch (err) {
    return {
      ok: false,
      reason: "extraction_error",
      message: `Failed to extract text from PDF: ${(err as Error).message}`,
    };
  }
}
// ---------------------------------------------------------------------------
// DOCX extraction
// ---------------------------------------------------------------------------

async function extractFromDocx(filePath: string): Promise<ExtractionResult> {
  try {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ path: filePath });

    // mammoth returns messages for things like missing images — not errors,
    // just informational. We don't need to surface these to the admin.
    const text = result.value.trim();

    if (!isTextDensitySufficient(text)) {
      return {
        ok: false,
        reason: "low_text_density",
        message:
          `This Word document appears to contain very little text (${text.length} characters). ` +
          `If the content is in images or text boxes, it cannot be extracted automatically.`,
      };
    }

    return { ok: true, text };
  } catch (err) {
    return {
      ok: false,
      reason: "extraction_error",
      message: `Failed to extract text from DOCX: ${(err as Error).message}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Main entry point — called by ai.service.ts
// ---------------------------------------------------------------------------

export async function extractTextFromFile(
  filePath: string
): Promise<ExtractionResult> {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case ".pdf":
      return extractFromPdf(filePath);
    case ".docx":
      return extractFromDocx(filePath);
    default:
      return {
        ok: false,
        reason: "unsupported_format",
        message: `Unsupported file format: ${ext}. Only PDF and DOCX are supported.`,
      };
  }
}