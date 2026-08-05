import { z } from "zod";

const safePersonName = /^[\p{L}\p{M}\s.'-]+$/u;
const containsLetter = /\p{L}/u;
const safeTracking = /^[\p{L}\p{N} ._\-:/+]+$/u;
const safeClickId = /^[A-Za-z0-9._~-]+$/;

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

function optionalSanitizedString(maxLength: number, pattern: RegExp) {
  return z.preprocess(
    (value) => {
      if (typeof value !== "string") return undefined;

      const normalized = value.trim();

      if (
        !normalized
        || normalized.length > maxLength
        || !pattern.test(normalized)
      ) {
        return undefined;
      }

      return normalized;
    },
    z.string().optional(),
  );
}

function sanitizePageUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  const normalized = value.trim();

  if (!normalized || normalized.length > 500) {
    return undefined;
  }

  try {
    const url = new URL(normalized);

    if (!["http:", "https:"].includes(url.protocol)) {
      return undefined;
    }

    return url.toString();
  } catch {
    return undefined;
  }
}

const optionalTracking = optionalSanitizedString(120, safeTracking);
const optionalClickId = optionalSanitizedString(512, safeClickId);

const optionalPageUrl = z.preprocess(
  sanitizePageUrl,
  z.string().optional(),
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
  fbclid: optionalClickId,
  gclid: optionalClickId,
  ttclid: optionalClickId,
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
  fbclid: optionalClickId,
  gclid: optionalClickId,
  ttclid: optionalClickId,
  landingUrl: optionalPageUrl,
  referrer: optionalPageUrl,
});

export type LeadInput = z.infer<typeof leadInputSchema>;
export type PublicLeadFields = z.input<typeof publicLeadFieldsSchema>;
