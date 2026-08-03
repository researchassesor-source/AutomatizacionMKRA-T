import { z } from "zod";

const safePersonName = /^[\p{L}\p{M}\s.'-]+$/u;
const containsLetter = /\p{L}/u;
const safeTracking = /^[\p{L}\p{N} ._\-:/+]{0,120}$/u;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeEcuadorPhone(value: string): string {
  const raw = value.trim();
  if (!raw || /[A-Za-z]/.test(raw) || /[^\d+\s().-]/.test(raw)) {
    throw new Error("Revisa el número de WhatsApp ingresado.");
  }
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (/^09\d{8}$/.test(digits)) digits = `593${digits.slice(1)}`;
  if (!/^5939\d{8}$/.test(digits)) {
    throw new Error("Revisa el número de WhatsApp ingresado.");
  }
  return `+${digits}`;
}

function personName(emptyMessage: string, invalidMessage: string) {
  return z
    .string()
    .trim()
    .min(2, emptyMessage)
    .max(80, "El nombre es demasiado largo.")
    .refine((value) => containsLetter.test(value) && safePersonName.test(value), invalidMessage);
}

const requiredEmail = z.preprocess(
  (value) => typeof value === "string" ? value.trim() : "",
  z
    .string()
    .min(1, "Ingresa tu correo electrónico.")
    .email("Ingresa un correo electrónico válido.")
    .max(254, "El correo electrónico es demasiado largo."),
).transform(normalizeEmail);

const requiredPhone = z
  .string()
  .trim()
  .min(1, "Ingresa tu número de WhatsApp.")
  .max(30, "Revisa el número de WhatsApp ingresado.")
  .transform((value, context) => {
    try {
      return normalizeEcuadorPhone(value);
    } catch (error) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: (error as Error).message });
      return z.NEVER;
    }
  });

const optionalTracking = z.preprocess(
  (value) => typeof value === "string" && value.trim() ? value.trim() : undefined,
  z
    .string()
    .max(120, "El parámetro de campaña es demasiado largo.")
    .refine((value) => safeTracking.test(value), "Parámetro de campaña no válido.")
    .optional(),
);

const optionalPageUrl = z.preprocess(
  (value) => typeof value === "string" && value.trim() ? value.trim() : undefined,
  z
    .string()
    .max(500, "La URL de atribución es demasiado larga.")
    .url("La URL de atribución no es válida.")
    .refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "La URL de atribución no es válida.")
    .optional(),
);

export const publicLeadFieldsSchema = z.object({
  firstName: personName("Ingresa tu nombre.", "Ingresa tu nombre."),
  lastName: personName("Ingresa tus apellidos.", "Ingresa tus apellidos."),
  email: requiredEmail,
  phone: requiredPhone,
  consent: z.literal(true, {
    errorMap: () => ({ message: "Debes aceptar el tratamiento de tus datos." }),
  }),
});

export const leadInputSchema = publicLeadFieldsSchema.extend({
  courseSlug: z
    .string()
    .trim()
    .min(1, "El curso seleccionado no está disponible.")
    .max(120, "El curso seleccionado no está disponible.")
    .regex(/^[a-z0-9-]+$/, "El curso seleccionado no está disponible."),
  source: optionalTracking,
  utmSource: optionalTracking,
  utmMedium: optionalTracking,
  utmCampaign: optionalTracking,
  utmContent: optionalTracking,
  utmTerm: optionalTracking,
  fbclid: optionalTracking,
  gclid: optionalTracking,
  ttclid: optionalTracking,
  landingUrl: optionalPageUrl,
  referrer: optionalPageUrl,
  website: z.string().max(200).optional().or(z.literal("")),
  formStartedAt: z.number().int().positive(),
  idempotencyKey: z.string().min(8).max(80).regex(/^[A-Za-z0-9_-]+$/),
});

export const leadActivitySchema = z.object({
  eventType: z.enum(["FORM_VIEWED", "FORM_STARTED"]),
  courseSlug: z.string().trim().min(1).max(120).regex(/^[a-z0-9-]+$/),
  activityKey: z.string().min(8).max(80).regex(/^[A-Za-z0-9_-]+$/),
  source: optionalTracking,
  utmSource: optionalTracking,
  utmMedium: optionalTracking,
  utmCampaign: optionalTracking,
  utmContent: optionalTracking,
  utmTerm: optionalTracking,
  fbclid: optionalTracking,
  gclid: optionalTracking,
  ttclid: optionalTracking,
  landingUrl: optionalPageUrl,
  referrer: optionalPageUrl,
});

export type LeadInput = z.infer<typeof leadInputSchema>;
export type PublicLeadFields = z.input<typeof publicLeadFieldsSchema>;
