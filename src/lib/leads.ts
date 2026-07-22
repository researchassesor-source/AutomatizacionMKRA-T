import { z } from "zod";
import { prisma } from "@/lib/db";

// Validacion del formulario de captacion de leads.
export const leadInputSchema = z.object({
  fullName: z.string().min(2, "Ingresa tu nombre completo").max(120),
  email: z.string().email("Correo no valido"),
  phone: z.string().min(6).max(30).optional().or(z.literal("")),
  courseSlug: z.string().optional(),
  consent: z.literal(true, {
    errorMap: () => ({ message: "Debes aceptar el tratamiento de datos" }),
  }),
  utmSource: z.string().optional(),
  utmMedium: z.string().optional(),
  utmCampaign: z.string().optional(),
});

export type LeadInput = z.infer<typeof leadInputSchema>;

/**
 * Registra (o actualiza) un lead a partir del formulario de un curso gratuito.
 * Si el correo ya existe se reutiliza el contacto y se registra el evento;
 * asi evitamos duplicados en la base del CRM.
 */
export async function captureLead(input: LeadInput) {
  const course = input.courseSlug
    ? await prisma.course.findUnique({ where: { slug: input.courseSlug } })
    : null;

  const existing = await prisma.lead.findFirst({
    where: { email: input.email.toLowerCase() },
  });

  const lead = existing
    ? await prisma.lead.update({
        where: { id: existing.id },
        data: {
          fullName: input.fullName,
          phone: input.phone || existing.phone,
          courseId: course?.id ?? existing.courseId,
          stage: existing.stage === "NUEVO" ? "INSCRITO" : existing.stage,
        },
      })
    : await prisma.lead.create({
        data: {
          fullName: input.fullName,
          email: input.email.toLowerCase(),
          phone: input.phone || null,
          courseId: course?.id ?? null,
          consent: input.consent,
          stage: "INSCRITO",
          source: input.utmSource ?? "landing",
          utmSource: input.utmSource,
          utmMedium: input.utmMedium,
          utmCampaign: input.utmCampaign,
        },
      });

  await prisma.leadEvent.create({
    data: {
      leadId: lead.id,
      type: "form_submit",
      payload: {
        courseSlug: input.courseSlug ?? null,
        utmCampaign: input.utmCampaign ?? null,
      },
    },
  });

  // Punto de enganche para la fase de nurture (email/WhatsApp de bienvenida).
  // await enqueueWelcomeSequence(lead.id);

  return lead;
}
