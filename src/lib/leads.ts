import { z } from "zod";
import { Prisma, type Course, type Enrollment, type Lead } from "@prisma/client";
import { prisma } from "@/lib/db";
import { enqueueSequence } from "@/lib/nurture/engine";
import { rescoreLead } from "@/lib/scoring";
import { writeAudit } from "@/lib/audit";

const safeText = /^[\p{L}\p{M}\s.'-]+$/u;
const safeTracking = /^[\p{L}\p{N} ._\-:/]{0,120}$/u;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeEcuadorPhone(value: string): string {
  const raw = value.trim();
  if (!raw || /[A-Za-z]/.test(raw) || /[^\d+\s().-]/.test(raw)) {
    throw new Error("El número de WhatsApp no es válido.");
  }
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (/^09\d{8}$/.test(digits)) digits = `593${digits.slice(1)}`;
  if (!/^5939\d{8}$/.test(digits)) {
    throw new Error("Ingresa un WhatsApp de Ecuador válido, por ejemplo 0981234567.");
  }
  return `+${digits}`;
}

const optionalAdminId = z.string().trim().max(100).optional().or(z.literal(""));

export const manualContactInputSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "Ingresa el nombre completo.")
    .max(160, "El nombre es demasiado largo.")
    .regex(/^[\p{L}\p{M}\s.'-]+$/u, "El nombre contiene caracteres no válidos."),
  phone: z.string().trim().min(1, "WhatsApp es obligatorio.").max(30).transform((value, context) => {
    try {
      return normalizeEcuadorPhone(value);
    } catch (error) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: (error as Error).message });
      return z.NEVER;
    }
  }),
  email: z.preprocess(
    (value) => typeof value === "string" ? value.trim() : "",
    z.union([z.literal(""), z.string().email("El correo electrónico no es válido.").max(254)]),
  ).transform(normalizeEmail),
  courseId: optionalAdminId,
  source: z.string().trim().max(120, "El origen es demasiado largo.").optional().or(z.literal("")),
  assignedToId: optionalAdminId,
  consent: z.literal(true, { errorMap: () => ({ message: "Debes confirmar la autorización de tratamiento de datos." }) }),
});

const personName = z
  .string()
  .trim()
  .min(2, "Ingresa al menos 2 caracteres.")
  .max(80, "El nombre es demasiado largo.")
  .refine((value) => safeText.test(value), "Usa únicamente letras y signos habituales.");

const optionalTracking = z
  .string()
  .trim()
  .max(120)
  .refine((value) => safeTracking.test(value), "Parámetro de campaña no válido.")
  .optional();

const optionalPageUrl = z
  .string()
  .trim()
  .max(500)
  .url()
  .refine((value) => ["http:", "https:"].includes(new URL(value).protocol))
  .optional()
  .or(z.literal(""));

export const leadInputSchema = z.object({
  firstName: personName,
  lastName: personName,
  email: z.string().trim().email("El correo electrónico no es válido.").max(254).transform(normalizeEmail),
  phone: z.string().trim().min(1, "WhatsApp es obligatorio.").max(30).transform((value, context) => {
    try {
      return normalizeEcuadorPhone(value);
    } catch (error) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: (error as Error).message });
      return z.NEVER;
    }
  }),
  courseSlug: z.string().trim().min(1, "Selecciona un curso.").max(120).regex(/^[a-z0-9-]+$/),
  consent: z.literal(true, {
    errorMap: () => ({ message: "Debes aceptar el tratamiento de datos." }),
  }),
  utmSource: optionalTracking,
  utmMedium: optionalTracking,
  utmCampaign: optionalTracking,
  landingUrl: optionalPageUrl,
  referrer: optionalPageUrl,
  website: z.string().max(0).optional().or(z.literal("")),
  formStartedAt: z.number().int().positive(),
  idempotencyKey: z.string().min(8).max(80).regex(/^[A-Za-z0-9_-]+$/),
});

export type LeadInput = z.infer<typeof leadInputSchema>;

export function hasPlausibleFormTiming(formStartedAt: number, now = Date.now()): boolean {
  const elapsed = now - formStartedAt;
  return elapsed >= 1500 && elapsed <= 2 * 60 * 60 * 1000;
}

export async function captureLead(input: LeadInput) {
  const repeated = await prisma.leadEvent.findFirst({
    where: { idempotencyKey: input.idempotencyKey },
    include: { lead: true, enrollment: { include: { course: true } } },
  });
  if (repeated?.enrollment) {
    return {
      lead: repeated.lead,
      enrollment: repeated.enrollment,
      redirectUrl: repeated.enrollment.course.officialCourseUrl,
      created: false,
    };
  }

  const course = await prisma.course.findFirst({
    where: { slug: input.courseSlug, isPublished: true },
  });
  if (!course) throw new Error("COURSE_NOT_FOUND");

  const now = new Date();
  const fullName = `${input.firstName} ${input.lastName}`.replace(/\s+/g, " ").trim();

  let result: { lead: Lead; enrollment: Enrollment & { course: Course }; wasExisting: boolean } | null = null;
  for (let attempt = 0; attempt < 3 && !result; attempt++) {
    try {
      result = await prisma.$transaction(async (tx) => {
        const existing = await tx.lead.findFirst({ where: { email: input.email } });
        const lead = existing
          ? await tx.lead.update({
              where: { id: existing.id },
              data: {
                firstName: input.firstName,
                lastName: input.lastName,
                fullName,
                phone: input.phone,
                consent: true,
                consentAt: now,
                consentPolicyVersion: "2026-07",
                consentPurpose: "Información de cursos y seguimiento comercial",
                source: input.utmSource || existing.source || "landing",
                utmSource: input.utmSource || existing.utmSource,
                utmMedium: input.utmMedium || existing.utmMedium,
                utmCampaign: input.utmCampaign || existing.utmCampaign,
                landingUrl: input.landingUrl || existing.landingUrl,
                referrer: input.referrer || existing.referrer,
                stage: existing.stage === "NUEVO" ? "INSCRITO" : existing.stage,
                courseId: existing.courseId || course.id,
              },
            })
          : await tx.lead.create({
              data: {
                firstName: input.firstName,
                lastName: input.lastName,
                fullName,
                email: input.email,
                phone: input.phone,
                stage: "INSCRITO",
                consent: true,
                consentAt: now,
                consentPolicyVersion: "2026-07",
                consentPurpose: "Información de cursos y seguimiento comercial",
                source: input.utmSource || "landing",
                utmSource: input.utmSource,
                utmMedium: input.utmMedium,
                utmCampaign: input.utmCampaign,
                landingUrl: input.landingUrl || null,
                referrer: input.referrer || null,
                courseId: course.id,
              },
            });

        const enrollment = await tx.enrollment.upsert({
          where: { leadId_courseId: { leadId: lead.id, courseId: course.id } },
          update: {
            status: "INSCRITO",
            source: input.utmSource || "landing",
            utmSource: input.utmSource,
            utmMedium: input.utmMedium,
            utmCampaign: input.utmCampaign,
            landingUrl: input.landingUrl || null,
          },
          create: {
            leadId: lead.id,
            courseId: course.id,
            status: "INSCRITO",
            source: input.utmSource || "landing",
            utmSource: input.utmSource,
            utmMedium: input.utmMedium,
            utmCampaign: input.utmCampaign,
            landingUrl: input.landingUrl || null,
          },
          include: { course: true },
        });

        await tx.leadEvent.create({
          data: {
            leadId: lead.id,
            enrollmentId: enrollment.id,
            type: "form_submit",
            idempotencyKey: input.idempotencyKey,
            payload: {
              courseSlug: course.slug,
              utmCampaign: input.utmCampaign ?? null,
            },
          },
        });
        return { lead, enrollment, wasExisting: Boolean(existing) };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const duplicate = await prisma.leadEvent.findFirst({
        where: { idempotencyKey: input.idempotencyKey },
        include: { lead: true, enrollment: { include: { course: true } } },
      });
      if (duplicate?.enrollment) {
        return {
          lead: duplicate.lead,
          enrollment: duplicate.enrollment,
          redirectUrl: duplicate.enrollment.course.officialCourseUrl,
          created: false,
        };
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && attempt < 2) continue;
      throw error;
    }
  }
  if (!result) throw new Error("LEAD_CAPTURE_FAILED");

  try {
    await enqueueSequence(result.lead.id, result.enrollment.id);
    await rescoreLead(result.lead.id);
  } catch {
    console.error("[leads] No se pudo preparar el seguimiento.");
  }

  await writeAudit({
    action: result.wasExisting ? "LEAD_UPDATED_FROM_FORM" : "LEAD_CREATED",
    entityType: "Lead",
    entityId: result.lead.id,
    metadata: { enrollmentId: result.enrollment.id, courseId: course.id },
  });

  return { lead: result.lead, enrollment: result.enrollment, redirectUrl: course.officialCourseUrl, created: !result.wasExisting };
}
