import { z } from "zod";



export const AIQuestionSchema = z.object({
  questionText: z
    .string()
    .trim()
    .min(10, "Question text is too short"),

  options: z
    .array(z.string().trim().min(1, "Option cannot be empty"))
    .length(4, "Each question must have exactly 4 options"),

  correctOptionIndex: z
    .number()
    .int()
    .min(0)
    .max(3, "correctOptionIndex must be 0, 1, 2, or 3"),

  difficulty: z.enum(["EASY", "MEDIUM", "HARD"]),

  explanation: z
    .string()
    .trim()
    .min(10, "Explanation is too short to be useful"),
});

export const AIResponseSchema = z.object({
  questions: z.array(AIQuestionSchema).min(1, "Response must contain at least one question"),
});

export type AIQuestion = z.infer<typeof AIQuestionSchema>;
export type AIResponse = z.infer<typeof AIResponseSchema>;



export interface ContentIssue {
  questionIndex: number;
  message: string;
}

function runContentChecks(questions: AIQuestion[]): ContentIssue[] {
  const issues: ContentIssue[] = [];

  questions.forEach((q, index) => {
    // Check 1: no duplicate options within the same question
    const normalized = q.options.map((o) => o.toLowerCase().trim());
    if (new Set(normalized).size !== normalized.length) {
      issues.push({
        questionIndex: index,
        message: "Two or more options have identical text",
      });
    }

    
   const correctText = q.options[q.correctOptionIndex] ?? "";
    const otherTexts = q.options.filter((_, i) => i !== q.correctOptionIndex);
    const avgOtherLength = otherTexts.reduce((s, o) => s + o.length, 0) / 3;

    if (correctText.length < avgOtherLength * 0.4) {
      issues.push({
        questionIndex: index,
        message:
          "Correct answer is suspiciously shorter than distractors — review for obvious-answer pattern",
      });
    }
  });

  return issues;
}

// ---------------------------------------------------------------------------
// Single entry point used by ai.service.ts
// ---------------------------------------------------------------------------

export type ValidationResult =
  | { success: true; data: AIQuestion[] }
  | { success: false; errors: string[] };

export function validateAIResponse(rawResponse: unknown): ValidationResult {
  // Layer 1: shape validation
  const parsed = AIResponseSchema.safeParse(rawResponse);

  if (!parsed.success) {
    const errors = parsed.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`
    );
    return { success: false, errors };
  }

  // Layer 2: content validation
  const contentIssues = runContentChecks(parsed.data.questions);
  if (contentIssues.length > 0) {
    return {
      success: false,
      errors: contentIssues.map(
        (i) => `Question ${i.questionIndex + 1}: ${i.message}`
      ),
    };
  }

  return { success: true, data: parsed.data.questions };
}