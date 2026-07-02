import { z } from "zod";

// Validates the non-file fields sent alongside the SOP upload
export const CreateSOPSchema = z.object({
  title: z.string().trim().min(3, "Title must be at least 3 characters"),
  category: z.string().trim().min(2, "Category is required"),
  applicableTo: z
    .enum(["ALL", "TEACHING", "NON_TEACHING", "SPECIFIC_DEPARTMENTS"])
    .default("ALL"),
});

export type CreateSOPInput = z.infer<typeof CreateSOPSchema>;

// Validates the body when admin approves/edits a draft question
export const ReviewQuestionSchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  // Optional edits — only relevant when action is APPROVE
  text: z.string().trim().min(10).optional(),
  explanation: z.string().trim().min(10).optional(),
  options: z
    .array(z.string().trim().min(1))
    .length(4)
    .optional(),
  correctOptionIndex: z.number().int().min(0).max(3).optional(),
});

export type ReviewQuestionInput = z.infer<typeof ReviewQuestionSchema>;

// Validates query params for question listing
export const ListQuestionsSchema = z.object({
  status: z.enum(["DRAFT", "APPROVED", "REJECTED", "ALL"]).default("ALL"),
});