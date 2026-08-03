import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { captureLead, hasPlausibleFormTiming, leadInputSchema } from "@/lib/leads";
import { checkRateLimit, requestKey } from "@/lib/rate-limit";
import { PayloadTooLargeError, readJsonBody } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import {
  isAllowedPublicLeadOrigin,
  publicLeadCorsHeaders,
} from "@/lib/public-origin";

export const dynamic = "force-dynamic";

function requestId(request: Request) {
  const provided = request.headers.get("x-request-id")?.trim();
  return provided && /^[A-Za-z0-9_-]{8,80}$/.test(provided) ? provided : crypto.randomUUID();
}

function responseHeaders(request: Request, id: string, additional?: HeadersInit) {
  const headers = publicLeadCorsHeaders(request.headers.get("origin"), request.url);
  headers.set("X-Request-Id", id);
  if (additional) {
    new Headers(additional).forEach((value, key) => {
      headers.set(key, value);
    });
  }
  return headers;
}

function json(request: Request, id: string, body: unknown, status: number, additional?: HeadersInit) {
  return NextResponse.json(body, { status, headers: responseHeaders(request, id, additional) });
}

async function auditFailure(action: string, id: string, metadata?: Record<string, unknown>) {
  await writeAudit({
    actorEmail: "public-form",
    action,
    entityType: "PublicLeadForm",
    result: "FAILURE",
    metadata: { requestId: id, ...metadata },
  });
}

export async function OPTIONS(request: Request) {
  const id = requestId(request);
  const origin = request.headers.get("origin");
  if (!isAllowedPublicLeadOrigin(origin, request.url)) {
    return json(request, id, { error: "Origen no permitido." }, 403);
  }
  return new Response(null, { status: 204, headers: responseHeaders(request, id) });
}

export async function POST(request: Request) {
  const id = requestId(request);
  const origin = request.headers.get("origin");
  if (!isAllowedPublicLeadOrigin(origin, request.url)) {
    await auditFailure("FORM_SUBMIT_BLOCKED", id, { reason: "origin" });
    return json(request, id, { error: "Origen no permitido." }, 403);
  }

  const limit = checkRateLimit(requestKey(request, "lead-capture"), {
    limit: 12,
    windowMs: 10 * 60 * 1000,
  });
  if (!limit.allowed) {
    await auditFailure("FORM_SUBMIT_BLOCKED", id, { reason: "rate-limit" });
    return json(
      request,
      id,
      { error: "Has realizado varios intentos. Espera unos minutos e inténtalo nuevamente." },
      429,
      { "Retry-After": String(limit.retryAfterSeconds) },
    );
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    await auditFailure("FORM_SUBMIT_VALIDATION_FAILED", id, { reason: "content-type" });
    return json(request, id, { error: "El contenido de la solicitud no es válido." }, 415);
  }

  await writeAudit({
    actorEmail: "public-form",
    action: "FORM_SUBMIT_ATTEMPT",
    entityType: "PublicLeadForm",
    metadata: { requestId: id },
  });

  try {
    const input = leadInputSchema.parse(await readJsonBody(request, 16_384));
    if (input.website || !hasPlausibleFormTiming(input.formStartedAt)) {
      await auditFailure("FORM_SUBMIT_BLOCKED", id, {
        reason: input.website ? "spam" : "timing",
        courseSlug: input.courseSlug,
      });
      return json(
        request,
        id,
        { error: "No pudimos completar el registro. Inténtalo nuevamente." },
        422,
      );
    }
    const result = await captureLead(input, { requestId: id });
    return json(
      request,
      id,
      {
        ok: true,
        leadId: result.lead.id,
        interestId: result.enrollment.id,
        enrollmentId: result.enrollment.id,
        redirectUrl: result.redirectUrl,
        duplicate: result.duplicate,
        message: result.message,
      },
      result.created || result.enrollmentCreated ? 201 : 200,
    );
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      await auditFailure("FORM_SUBMIT_VALIDATION_FAILED", id, { reason: "payload-too-large" });
      return json(request, id, { error: "La solicitud es demasiado grande." }, 413);
    }
    if (error instanceof SyntaxError) {
      await auditFailure("FORM_SUBMIT_VALIDATION_FAILED", id, { reason: "invalid-json" });
      return json(request, id, { error: "La solicitud contiene JSON no válido." }, 400);
    }
    if (error instanceof ZodError) {
      await auditFailure("FORM_SUBMIT_VALIDATION_FAILED", id, {
        reason: "schema",
        field: String(error.errors[0]?.path[0] ?? "unknown"),
      });
      return json(
        request,
        id,
        { error: error.errors[0]?.message ?? "Datos no válidos." },
        422,
      );
    }
    if (error instanceof Error && error.message === "COURSE_NOT_FOUND") {
      await auditFailure("FORM_SUBMIT_VALIDATION_FAILED", id, { reason: "course-not-found" });
      return json(request, id, { error: "No encontramos el curso solicitado." }, 404);
    }
    if (error instanceof Error && error.message === "COURSE_UNAVAILABLE") {
      await auditFailure("FORM_SUBMIT_VALIDATION_FAILED", id, { reason: "course-unavailable" });
      return json(request, id, { error: "Este curso no está disponible para registros." }, 422);
    }
    if (error instanceof Error && error.message === "CONTACT_IDENTITY_CONFLICT") {
      await auditFailure("FORM_SUBMIT_BLOCKED", id, { reason: "identity-conflict" });
      return json(
        request,
        id,
        { error: "El correo y el WhatsApp pertenecen a contactos diferentes. Solicita asistencia." },
        409,
      );
    }
    console.error(`[leads] No se pudo registrar el contacto. requestId=${id}`);
    await auditFailure("FORM_SUBMIT_BLOCKED", id, { reason: "server" });
    return json(
      request,
      id,
      { error: "No pudimos completar el registro. Inténtalo nuevamente." },
      500,
    );
  }
}
