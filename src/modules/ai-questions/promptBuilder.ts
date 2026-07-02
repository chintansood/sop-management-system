/**
 * ─────────────────────────────────────────────────────────────────────────
 * WHY PROMPTS ARE BUILT IN A SEPARATE FILE
 * ─────────────────────────────────────────────────────────────────────────
 * Prompt engineering is iterative — you will change the wording, tweak
 * the difficulty split, or adjust the output schema multiple times before
 * the questions feel right. If the prompt lived inside ai.service.ts,
 * every tweak would require you to navigate through orchestration code.
 *
 * This file is purely a string factory: it takes SOP metadata + text
 * and returns exactly what Gemini will receive. No side effects, no DB
 * calls, no API calls — just a function that builds a string.
 * That makes it trivially testable: call it with any input, check the output.
 * ─────────────────────────────────────────────────────────────────────────
 */

export interface PromptInput {
  sopTitle: string;
  sopId: string;
  extractedText: string;
  questionCount: number;
}

/**
 * Builds the system instruction sent to Gemini.
 * This is the persistent "who you are and what you must do" context
 * that applies regardless of which SOP we're generating for.
 */
export function buildSystemInstruction(): string {
  return `You are an assessment-question generator for a school's internal compliance training system.
Your only job is to write multiple-choice questions that test whether a staff member has understood a specific Standard Operating Procedure (SOP) document.

You must follow these rules strictly:

1. Base every question ONLY on the SOP text provided. Do not introduce outside knowledge about "typical" procedures that are not explicitly stated in the provided text.

2. Each question must have exactly 4 answer options, and exactly one of them must be correct.

3. The 3 incorrect options (distractors) must be plausible — they should represent realistic mistakes a staff member might actually make, not obviously wrong filler.

4. Do not make the correct answer identifiable by being noticeably longer, more detailed, or more formally worded than the distractors. All 4 options should be similar in length and tone.

5. Prioritize parts of the SOP that carry real safety or compliance risk if misunderstood — specific numbers, named roles, hard prohibitions, and edge cases.

6. Distribute difficulty levels: roughly one-third EASY, one-third MEDIUM, one-third HARD.
   - EASY: a directly stated fact, one step away from the text.
   - MEDIUM: requires connecting two parts of the procedure.
   - HARD: an edge case, exception, or conditional scenario implied by the text.

7. For each question, provide a brief explanation (1-2 sentences) of why the correct answer is correct. This will be shown to the learner after they answer — it should teach, not just confirm.

8. Return ONLY valid JSON matching the exact schema specified. No commentary, no markdown formatting, no text outside the JSON object.`;
}

/**
 * Builds the user message containing the actual SOP content and output schema.
 * This changes per SOP — title, ID, text, and question count are all dynamic.
 */
export function buildUserPrompt(input: PromptInput): string {
  const { sopTitle, sopId, extractedText, questionCount } = input;

  // Truncate very long documents to avoid hitting token limits.
  // GPT-4 context: ~128k tokens. Gemini 1.5 Flash: ~1M tokens.
  // A typical SOP is 500-3000 words, well within limits.
  // We cap at 8000 chars (~2000 tokens) as a safety margin.
  const truncatedText =
    extractedText.length > 8000
      ? extractedText.slice(0, 8000) +
        "\n\n[Document truncated for length — generate questions from the content above only]"
      : extractedText;

  return `Generate exactly ${questionCount} multiple-choice questions based on the following SOP.

SOP TITLE: ${sopTitle}
SOP ID: ${sopId}

SOP TEXT:
"""
${truncatedText}
"""

Return your response as a single JSON object matching EXACTLY this schema:

{
  "questions": [
    {
      "questionText": "string — the question being asked",
      "options": ["string", "string", "string", "string"],
      "correctOptionIndex": 0,
      "difficulty": "EASY" | "MEDIUM" | "HARD",
      "explanation": "string — why the correct answer is correct, referencing the SOP"
    }
  ]
}

Rules for the JSON:
- "questions" must contain exactly ${questionCount} items.
- "options" must contain exactly 4 strings.
- "correctOptionIndex" must be 0, 1, 2, or 3 — the index of the correct option in the "options" array.
- All strings must be non-empty.
- No two options within the same question may have identical text.`;
}