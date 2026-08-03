import { Prisma, type Course, type Enrollment, type Lead } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { rescoreLead } from "@/lib/scoring";
import { writeAudit } from "@/lib/audit";
import { scheduleEnrollmentAutomations } from "@/lib/nurture/engine";
import {
  normalizeEcuadorPhone,
  normalizeEmail,
  type LeadInput,
} from "@/lib/lead-validation";

export {
  leadInputSchema,
  normalizeEcuadorPhone,
  normalizeEmail,
  type LeadInput,
} from "@/lib/lead-validation";

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
  classification: z.enum(["REAL", "TEST", "DEMO", "UNKNOWN"]).default("UNKNOWN"),
  consent: z.literal(true, { errorMap: () => ({ message: "Debes confirmar la autorización de tratamiento de datos." }) }),
});

export function hasPlausibleFormTiming(formStartedAt: number, now = Date.now()): boolean {
  const elapsed = now - formStartedAt;
  return elapsed >= 1500 && elapsed <= 2 * 60 * 60 * 1000;
}

export type LeadCaptureContext = {
  requestId: string;
};

type CaptureResult = {
  lead: Lead;
  enrollment: Enrollment & { course: Course };
  leadCreated: boolean;
  enrollmentCreated: boolean;
  idempotent: boolean;
};

function redirectUrl(courseSlug: string, duplicate: boolean) {
  const params = new URLSearchParams({ curso: courseSlug });
  if (duplicate) params.set("actualizado", "1");
  return `/gracias?${params}`;
}

function enrollmentAttribution(input: LeadInput, fallbackSource = "landing") {
  return {
    source: input.source ?? input.utmSource ?? fallbackSource,
    utmSource: input.utmSource,
    utmMedium: input.utmMedium,
    utmCampaign: input.utmCampaign,
    utmContent: input.utmContent,
    utmTerm: input.utmTerm,
    landingUrl: input.landingUrl,
    referrer: input.referrer,
  };
}

async function writeCaptureAudits(result: CaptureResult, input: LeadInput, context: LeadCaptureContext) {
  const metadata = {
    requestId: context.requestId,
    enrollmentId: result.enrollment.id,
    courseId: result.enrollment.courseId,
    courseSlug: result.enrollment.course.slug,
    source: input.source ?? input.utmSource ?? "landing",
    campaign: input.utmCampaign,
    content: input.utmContent,
    term: input.utmTerm,
    fbclid: input.fbclid,
    gclid: input.gclid,
    ttclid: input.ttclid,
    landingUrl: input.landingUrl,
    referrer: input.referrer,
    deduplicated: !result.leadCreated,
  };
  const contactAudits = result.leadCreated
    ? [{
        actorEmail: "public-form",
        action: "CONTACT_CREATED",
        entityType: "Lead",
        entityId: result.lead.id,
        metadata,
      }]
    : ["CONTACT_UPDATED", "CONTACT_DEDUPLICATED"].map((action) => ({
        actorEmail: "public-form",
        action,
        entityType: "Lead",
        entityId: result.lead.id,
        metadata,
      }));
  await Promise.all([
    ...contactAudits.map((audit) => writeAudit(audit)),
    writeAudit({
      actorEmail: "public-form",
      action: result.enrollmentCreated ? "ENROLLMENT_CREATED" : "ENROLLMENT_REUSED",
      entityType: "Enrollment",
      entityId: result.enrollment.id,
      metadata,
    }),
    writeAudit({
      actorEmail: "public-form",
      action: "CONSENT_RECORDED",
      entityType: "Lead",
      entityId: result.lead.id,
      metadata: { ...metadata, policyVersion: "2026-08-course-capture-v1" },
    }),
    writeAudit({
      actorEmail: "public-form",
      action: "FORM_SUBMIT_SUCCESS",
      entityType: "Lead",
      entityId: result.lead.id,
      metadata,
    }),
  ]);
}

export async function captureLead(input: LeadInput, context: LeadCaptureContext) {
  const repeated = await prisma.leadEvent.findFirst({
    where: { idempotencyKey: input.idempotencyKey },
    include: { lead: true, enrollment: { include: { course: true } } },
  });
  if (repeated?.enrollment) {
    return {
      lead: repeated.lead,
      enrollment: repeated.enrollment,
      redirectUrl: redirectUrl(repeated.enrollment.course.slug, true),
      created: false,
      enrollmentCreated: false,
      duplicate: true,
      idempotent: true,
      message: "Ya teníamos registrado tu interés en este curso. Actualizamos tus datos correctamente.",
    };
  }

  const course = await prisma.course.findUnique({ where: { slug: input.courseSlug } });
  if (!course) throw new Error("COURSE_NOT_FOUND");
  if (!course.isPublished || !course.acceptsRegistrations) throw new Error("COURSE_UNAVAILABLE");

  const now = new Date();
  const fullName = `${input.firstName} ${input.lastName}`.replace(/\s+/g, " ").trim();
  let result: CaptureResult | null = null;

  for (let attempt = 0; attempt < 3 && !result; attempt++) {
    try {
      result = await prisma.$transaction(async (tx) => {
        const identityKeys = [`email:${input.email}`, `phone:${input.phone}`].sort();
        for (const identityKey of identityKeys) {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${identityKey}, 0))::text AS lock_result`;
        }

        const identityMatches = await tx.lead.findMany({
          where: { OR: [{ phone: input.phone }, { email: input.email }] },
        });
        if (identityMatches.length > 1) throw new Error("CONTACT_IDENTITY_CONFLICT");
        const existing = identityMatches[0];
        const captureSource = input.source ?? input.utmSource ?? existing?.source ?? "landing";
        const lead = existing
          ? await tx.lead.update({
              where: { id: existing.id },
              data: {
                firstName: input.firstName,
                lastName: input.lastName,
                fullName,
                email: input.email,
                phone: input.phone,
                consent: true,
                consentAt: now,
                consentPolicyVersion: "2026-08-course-capture-v1",
                consentPurpose: "Gestionar la inscripción y contactar sobre el curso solicitado",
                classification: existing.classification === "UNKNOWN" ? "REAL" : existing.classification,
                source: captureSource,
                utmSource: input.utmSource ?? existing.utmSource,
                utmMedium: input.utmMedium ?? existing.utmMedium,
                utmCampaign: input.utmCampaign ?? existing.utmCampaign,
                utmContent: input.utmContent ?? existing.utmContent,
                utmTerm: input.utmTerm ?? existing.utmTerm,
                landingUrl: input.landingUrl ?? existing.landingUrl,
                referrer: input.referrer ?? existing.referrer,
                stage: existing.stage,
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
                stage: "NUEVO",
                consent: true,
                consentAt: now,
                consentPolicyVersion: "2026-08-course-capture-v1",
                consentPurpose: "Gestionar la inscripción y contactar sobre el curso solicitado",
                classification: "REAL",
                source: captureSource,
                utmSource: input.utmSource,
                utmMedium: input.utmMedium,
                utmCampaign: input.utmCampaign,
                utmContent: input.utmContent,
                utmTerm: input.utmTerm,
                landingUrl: input.landingUrl,
                referrer: input.referrer,
                courseId: course.id,
              },
            });

        const existingEnrollment = await tx.enrollment.findUnique({
          where: { leadId_courseId: { leadId: lead.id, courseId: course.id } },
        });
        const campaign = input.utmCampaign
          ? await tx.campaign.findFirst({
              where: {
                status: "ACTIVE",
                OR: [{ code: input.utmCampaign }, { utmCampaign: input.utmCampaign }],
                AND: [
                  { OR: [{ courseId: null }, { courseId: course.id }] },
                  { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
                  { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
                ],
              },
              orderBy: { updatedAt: "desc" },
            })
          : null;
        const attribution = enrollmentAttribution(input, captureSource);
        const enrollment = existingEnrollment
          ? await tx.enrollment.update({
              where: { id: existingEnrollment.id },
              data: {
                source: attribution.source,
                utmSource: attribution.utmSource ?? existingEnrollment.utmSource,
                utmMedium: attribution.utmMedium ?? existingEnrollment.utmMedium,
                utmCampaign: attribution.utmCampaign ?? existingEnrollment.utmCampaign,
                utmContent: attribution.utmContent ?? existingEnrollment.utmContent,
                utmTerm: attribution.utmTerm ?? existingEnrollment.utmTerm,
                landingUrl: attribution.landingUrl ?? existingEnrollment.landingUrl,
                referrer: attribution.referrer ?? existingEnrollment.referrer,
                campaignId: campaign?.id ?? existingEnrollment.campaignId,
              },
              include: { course: true },
            })
          : await tx.enrollment.create({
              data: {
                leadId: lead.id,
                courseId: course.id,
                status: "INTERESADO",
                campaignId: campaign?.id,
                ...attribution,
              },
              include: { course: true },
            });

        const commonPayload = {
          requestId: context.requestId,
          courseSlug: course.slug,
          source: captureSource,
          utmSource: input.utmSource ?? null,
          utmMedium: input.utmMedium ?? null,
          utmCampaign: input.utmCampaign ?? null,
          utmContent: input.utmContent ?? null,
          utmTerm: input.utmTerm ?? null,
          fbclid: input.fbclid ?? null,
          gclid: input.gclid ?? null,
          ttclid: input.ttclid ?? null,
          landingUrl: input.landingUrl ?? null,
          referrer: input.referrer ?? null,
          deduplicated: Boolean(existing),
          campaignId: campaign?.id ?? existingEnrollment?.campaignId ?? null,
        };
        await tx.leadEvent.create({
          data: {
            leadId: lead.id,
            enrollmentId: enrollment.id,
            type: "form_submit",
            idempotencyKey: input.idempotencyKey,
            payload: commonPayload,
          },
        });
        await tx.leadEvent.createMany({
          data: [
            {
              leadId: lead.id,
              enrollmentId: enrollment.id,
              type: existing ? "CONTACT_UPDATED" : "CONTACT_CREATED",
              payload: commonPayload,
            },
            ...(existing ? [{
              leadId: lead.id,
              enrollmentId: enrollment.id,
              type: "CONTACT_DEDUPLICATED",
              payload: commonPayload,
            }] : []),
            {
              leadId: lead.id,
              enrollmentId: enrollment.id,
              type: existingEnrollment ? "ENROLLMENT_REUSED" : "ENROLLMENT_CREATED",
              payload: commonPayload,
            },
            {
              leadId: lead.id,
              enrollmentId: enrollment.id,
              type: "CONSENT_RECORDED",
              payload: {
                ...commonPayload,
                accepted: true,
                acceptedAt: now.toISOString(),
                policyVersion: "2026-08-course-capture-v1",
              },
            },
            {
              leadId: lead.id,
              enrollmentId: enrollment.id,
              type: "FORM_SUBMIT_SUCCESS",
              payload: commonPayload,
            },
          ],
        });
        return {
          lead,
          enrollment,
          leadCreated: !existing,
          enrollmentCreated: !existingEnrollment,
          idempotent: false,
        };
      }, {
        // Los advisory locks serializan cada identidad. READ COMMITTED hace que
        // la consulta posterior al lock vea el commit de la captura anterior;
        // SERIALIZABLE fijaba un snapshot obsoleto mientras esperaba el lock.
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 5_000,
        timeout: 15_000,
      });
    } catch (error) {
      const duplicate = await prisma.leadEvent.findFirst({
        where: { idempotencyKey: input.idempotencyKey },
        include: { lead: true, enrollment: { include: { course: true } } },
      });
      if (duplicate?.enrollment) {
        return {
          lead: duplicate.lead,
          enrollment: duplicate.enrollment,
          redirectUrl: redirectUrl(duplicate.enrollment.course.slug, true),
          created: false,
          enrollmentCreated: false,
          duplicate: true,
          idempotent: true,
          message: "Ya teníamos registrado tu interés en este curso. Actualizamos tus datos correctamente.",
        };
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && attempt < 2) continue;
      throw error;
    }
  }
  if (!result) throw new Error("LEAD_CAPTURE_FAILED");

  try {
    await rescoreLead(result.lead.id);
  } catch {
    console.error("[leads] No se pudo preparar el seguimiento.");
  }
  await writeCaptureAudits(result, input, context);
  try {
    await scheduleEnrollmentAutomations(result.enrollment.id);
  } catch {
    console.error("[leads] No se pudo programar la automatización del curso.");
    await writeAudit({
      actorEmail: "automation",
      action: "AUTOMATION_SCHEDULING_FAILED",
      entityType: "Enrollment",
      entityId: result.enrollment.id,
      result: "FAILURE",
      metadata: { requestId: context.requestId, courseId: result.enrollment.courseId },
    });
  }

  const duplicate = !result.enrollmentCreated;
  return {
    lead: result.lead,
    enrollment: result.enrollment,
    redirectUrl: redirectUrl(course.slug, duplicate),
    created: result.leadCreated,
    enrollmentCreated: result.enrollmentCreated,
    duplicate,
    idempotent: result.idempotent,
    message: duplicate
      ? "Ya teníamos registrado tu interés en este curso. Actualizamos tus datos correctamente."
      : "¡Registro recibido!",
  };
}
