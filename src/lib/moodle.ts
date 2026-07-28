import { z } from "zod";

export const moodleCompletionSchema = z.object({
  eventId: z.string().min(8).max(120),
  enrollmentId: z.string().min(1).max(120),
  email: z.string().email().transform((value) => value.trim().toLowerCase()),
  courseSlug: z.string().regex(/^[a-z0-9-]+$/),
  moodleEnrollmentId: z.string().max(120).optional(),
});
