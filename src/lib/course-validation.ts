import { z } from "zod";
import { COURSE_CATALOG_URL } from "@/data/courses";

export function isTrustedOfficialCourseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["ra-training.com", "www.ra-training.com"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function isTrustedMoodleUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "moodle.ra-training.com";
  } catch {
    return false;
  }
}

export const courseInputSchema = z.object({
  slug: z.string().trim().min(3).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "El identificador solo admite letras minúsculas, números y guiones."),
  title: z.string().trim().min(3).max(180),
  subtitle: z.string().trim().max(220).optional().or(z.literal("")),
  description: z.string().trim().max(3000).optional().or(z.literal("")),
  category: z.string().trim().max(100).optional().or(z.literal("")),
  officialCourseUrl: z
    .string()
    .trim()
    .default(COURSE_CATALOG_URL)
    .refine(isTrustedOfficialCourseUrl, "La URL oficial debe pertenecer a ra-training.com."),
  courseCompleteUrl: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .refine((value) => !value || (value.startsWith("https://") && z.string().url().safeParse(value).success), "La URL del curso completo debe ser HTTPS."),
  whatsappGroupUrl: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .refine((value) => !value || (value.startsWith("https://") && z.string().url().safeParse(value).success), "La URL del grupo de WhatsApp debe ser HTTPS."),
  surveyUrl: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .refine((value) => !value || (value.startsWith("https://") && z.string().url().safeParse(value).success), "La URL de encuesta debe ser HTTPS."),
  /**
   * Configuracion comercial de las tres modalidades del mismo curso de 60 h.
   *
   * Los precios se guardan por curso porque el importe inicial es de
   * lanzamiento y va a cambiar. Ninguna decision del sistema los mira: la
   * modalidad la determina `offerType`, nunca el importe.
   */
  institutionalOfferUrl: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .refine((value) => !value || (value.startsWith("https://") && z.string().url().safeParse(value).success), "La URL de la oferta institucional debe ser HTTPS."),
  upgradeOfferUrl: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .refine((value) => !value || (value.startsWith("https://") && z.string().url().safeParse(value).success), "La URL de la mejora con aval debe ser HTTPS."),
  fullOfferPrice: z.coerce.number().min(0).max(100_000).optional().nullable(),
  institutionalOfferPrice: z.coerce.number().min(0).max(100_000).optional().nullable(),
  upgradeOfferPrice: z.coerce.number().min(0).max(100_000).optional().nullable(),
  institutionalOfferDelayHours: z.coerce.number().int().min(0).max(720).optional(),
  moodleCourseUrl: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .refine((value) => !value || isTrustedMoodleUrl(value), "La URL de Moodle no es válida."),
  /**
   * Vínculo estable con el Servicio de Finance (no el nombre del curso).
   * Vacío = todavía sin vincular: Finance sigue cayendo al contrato heredado
   * por nombre normalizado hasta que alguien lo configure aquí.
   */
  financeServiceId: z.string().trim().max(120).optional().or(z.literal("")),
  imageUrl: z.string().trim().url().max(1000).optional().or(z.literal("")),
  price: z.union([z.number().nonnegative().max(100000), z.string().trim()]).optional().transform((value, context) => {
    if (value === undefined || value === "") return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || number > 100000) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "El precio no es válido." });
      return z.NEVER;
    }
    return number;
  }),
  duration: z.string().trim().max(80).optional().or(z.literal("")),
  modality: z.string().trim().max(80).optional().or(z.literal("")),
  startsAt: z.union([z.literal(""), z.string().datetime()]).optional(),
  endsAt: z.union([z.literal(""), z.string().datetime()]).optional(),
  isFree: z.boolean().default(false),
  isPublished: z.boolean().default(false),
  acceptsRegistrations: z.boolean().default(false),
  isLeadMagnet: z.boolean().default(false),
  hasCertificate: z.boolean().default(false),
  displayOrder: z.number().int().min(0).max(10000).default(0),
}).superRefine((data, context) => {
  if (data.startsAt && data.endsAt && new Date(data.endsAt) < new Date(data.startsAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["endsAt"], message: "La fecha de cierre no puede ser anterior a la fecha de inicio." });
  }
});

export function courseData(input: z.infer<typeof courseInputSchema>) {
  return {
    ...input,
    subtitle: input.subtitle || null,
    description: input.description || null,
    category: input.category || null,
    courseCompleteUrl: input.courseCompleteUrl || null,
    whatsappGroupUrl: input.whatsappGroupUrl || null,
    surveyUrl: input.surveyUrl || null,
    institutionalOfferUrl: input.institutionalOfferUrl || null,
    upgradeOfferUrl: input.upgradeOfferUrl || null,
    moodleCourseUrl: input.moodleCourseUrl || null,
    financeServiceId: input.financeServiceId || null,
    imageUrl: input.imageUrl || null,
    duration: input.duration || null,
    modality: input.modality || null,
    startsAt: input.startsAt ? new Date(input.startsAt) : null,
    endsAt: input.endsAt ? new Date(input.endsAt) : null,
  };
}
