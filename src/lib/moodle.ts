import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export function signMoodleWebhookBody(rawBody: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
}

export function verifyMoodleWebhookSignature(
  rawBody: string,
  suppliedSignature: string | null,
  secret: string | undefined,
): boolean {
  if (!secret || !suppliedSignature || !/^sha256=[a-f0-9]{64}$/i.test(suppliedSignature)) return false;
  const expected = Buffer.from(signMoodleWebhookBody(rawBody, secret), "utf8");
  const supplied = Buffer.from(suppliedSignature.toLowerCase(), "utf8");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export const moodleCompletionSchema = z.object({
  eventId: z.string().min(8).max(120),
  enrollmentId: z.string().min(1).max(120),
  email: z.string().email().transform((value) => value.trim().toLowerCase()),
  courseSlug: z.string().regex(/^[a-z0-9-]+$/),
  moodleEnrollmentId: z.string().max(120).optional(),
});
