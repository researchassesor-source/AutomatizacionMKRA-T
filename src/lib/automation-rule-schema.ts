import { z } from "zod";

export const automationRuleFields = z.object({
  courseId: z.string().min(1),
  campaignId: z.string().nullable().optional(),
  name: z.string().trim().min(3).max(140),
  trigger: z.enum(["ON_REGISTRATION", "BEFORE_COURSE", "AFTER_COURSE"]),
  offsetMinutes: z.coerce.number().int().min(0).max(525_600),
  channel: z.enum(["EMAIL", "WHATSAPP"]),
  subject: z.string().trim().max(200).nullable().optional(),
  body: z.string().trim().min(5).max(10_000),
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"]).default("DRAFT"),
  enrollmentStatuses: z.array(z.enum(["INTERESADO", "INSCRITO", "EN_CURSO", "COMPLETADO", "CANCELADO"])).min(1).default(["INTERESADO", "INSCRITO"]),
});

export const automationRuleSchema = automationRuleFields.refine(
  (value) => value.channel !== "EMAIL" || Boolean(value.subject),
  { message: "El asunto es obligatorio para correo." },
);
