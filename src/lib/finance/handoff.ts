import { prisma } from "@/lib/db";
import { markCrmCourseCompleted } from "./commerce";
import type { Prisma } from "@prisma/client";
import { resolveCourseSessions } from "@/lib/course-sessions";
import { scheduleEnrollmentAutomations } from "@/lib/nurture/engine";
import {
  createInscripcion,
  financeEnrollmentUrl,
  financeVerificationUrl,
  isFinanceConfigured,
  isFinanceSimulation,
  type FinanceEnrollmentInput,
} from "./client";
import { writeAudit } from "@/lib/audit";
import type { AdminSession } from "@/lib/auth/session";

type EnrollmentForFinance = Prisma.EnrollmentGetPayload<{
  include: { lead: true; course: { include: { sessions: true } } };
}>;

type HandoffPurpose = "REGISTRATION_CONFIRMATION" | "COURSE_COMPLETION";

export function buildFinanceEnrollmentInput(enrollment: EnrollmentForFinance): FinanceEnrollmentInput {
  const modality = enrollment.course.modality?.trim();
  if (!modality) throw new Error("FINANCE_COURSE_MODALITY_MISSING");
  const sessions = resolveCourseSessions(enrollment.course, enrollment.course.sessions);
  if (sessions.length === 0) throw new Error("FINANCE_COURSE_DATES_MISSING");
  const first = sessions[0];
  const last = sessions[sessions.length - 1];
  return {
    crmEnrollmentId: enrollment.id,
    crmContactId: enrollment.leadId,
    crmCourseId: enrollment.courseId,
    financeServiceId: enrollment.course.financeServiceId,
    courseTitle: enrollment.course.title,
    courseSlug: enrollment.course.slug,
    modality,
    startDate: first.startAt.toISOString(),
    endDate: (last.endAt ?? last.startAt).toISOString(),
    timezone: first.timezone,
    participant: {
      firstName: enrollment.lead.firstName,
      lastName: enrollment.lead.lastName,
      fullName: enrollment.lead.fullName,
      email: enrollment.lead.email,
      phone: enrollment.lead.phone,
      identification: null,
    },
    amount: enrollment.course.price === null ? null : Number(enrollment.course.price),
  };
}

function safeFinanceError(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  if (code === "FINANCE_COURSE_MODALITY_MISSING") return "El curso no tiene modalidad configurada.";
  if (code === "FINANCE_COURSE_DATES_MISSING") return "El curso no tiene fechas configuradas.";
  if (code === "FINANCE_NOT_AVAILABLE") return "Finance no está disponible para confirmar la inscripción.";
  if (code === "FINANCE_SERVICE_NOT_CONFIGURED") return "Este curso no está configurado como un servicio activo en Finance.";
  if (code === "FINANCE_AUTH_FAILED") return "Finance no está disponible en este momento.";
  if (code === "FINANCE_TRANSPORT_FAILED") return "No se pudo conectar con Finance en este momento.";
  return "Finance no pudo procesar la inscripción.";
}

async function reconcileExistingLink(enrollment: EnrollmentForFinance, purpose: HandoffPurpose) {
  if (!enrollment.financeInscripcionId) return false;
  const shouldConfirm = purpose === "REGISTRATION_CONFIRMATION" && enrollment.status === "INTERESADO";
  await prisma.$transaction(async (tx) => {
    await tx.enrollment.update({
      where: { id: enrollment.id },
      data: {
        financeStatus: "ENVIADO",
        lastHandoffError: null,
        ...(shouldConfirm ? { status: "INSCRITO" } : {}),
      },
    });
    if (shouldConfirm) {
      await tx.lead.updateMany({ where: { id: enrollment.leadId, stage: "NUEVO" }, data: { stage: "INSCRITO" } });
    }
  });
  if (shouldConfirm) await scheduleEnrollmentAutomations(enrollment.id).catch(() => undefined);
  return true;
}

export async function handoffEnrollment(
  enrollmentId: string,
  session?: AdminSession | null,
  purpose: HandoffPurpose = "COURSE_COMPLETION",
) {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: { lead: true, course: { include: { sessions: true } } },
  });
  if (!enrollment) throw new Error("ENROLLMENT_NOT_FOUND");
  if (enrollment.financeInscripcionId) {
    await reconcileExistingLink(enrollment, purpose);
    return {
      ok: true,
      reused: true,
      simulated: false,
      financeInscripcionId: enrollment.financeInscripcionId,
      financeUrl: financeEnrollmentUrl(enrollment.financeInscripcionId),
      verifyUrl: financeVerificationUrl(enrollment.financeInscripcionId),
    };
  }
  if (purpose === "COURSE_COMPLETION" && enrollment.status !== "COMPLETADO") {
    throw new Error("ENROLLMENT_NOT_COMPLETED");
  }
  if (purpose === "REGISTRATION_CONFIRMATION" && enrollment.status === "CANCELADO") {
    throw new Error("ENROLLMENT_NOT_ELIGIBLE");
  }

  if (isFinanceSimulation() || !isFinanceConfigured()) {
    if (purpose === "REGISTRATION_CONFIRMATION") {
      await prisma.enrollment.update({
        where: { id: enrollment.id },
        data: {
          financeStatus: "ERROR",
          handoffAttempts: { increment: 1 },
          lastHandoffAt: new Date(),
          lastHandoffError: safeFinanceError(new Error("FINANCE_NOT_AVAILABLE")),
        },
      });
      throw new Error("FINANCE_NOT_AVAILABLE");
    }
    const claimed = await prisma.enrollment.updateMany({
      where: { id: enrollment.id, financeStatus: { in: ["NO_ENVIADO", "ERROR"] } },
      data: {
        financeStatus: "PENDIENTE",
        handoffAttempts: { increment: 1 },
        lastHandoffAt: new Date(),
        lastHandoffError: null,
      },
    });
    if (claimed.count !== 1) {
      return { ok: true, reused: true, simulated: true, financeInscripcionId: null, financeUrl: "", verifyUrl: "" };
    }
    await prisma.leadEvent.upsert({
      where: { idempotencyKey: `finance-simulation:${enrollment.id}` },
      update: {},
      create: {
        leadId: enrollment.leadId,
        enrollmentId: enrollment.id,
        type: "finance_handoff_simulated",
        idempotencyKey: `finance-simulation:${enrollment.id}`,
        payload: { courseId: enrollment.courseId },
      },
    });
    await writeAudit({
      session,
      action: "FINANCE_HANDOFF_SIMULATED",
      entityType: "Enrollment",
      entityId: enrollment.id,
    });
    return { ok: true, simulated: true, financeInscripcionId: null, financeUrl: "", verifyUrl: "" };
  }

  const claimed = await prisma.enrollment.updateMany({
    where: { id: enrollment.id, financeStatus: { in: ["NO_ENVIADO", "PENDIENTE", "ERROR"] } },
    data: {
      financeStatus: "ENVIANDO",
      handoffAttempts: { increment: 1 },
      lastHandoffAt: new Date(),
      lastHandoffError: null,
    },
  });
  if (claimed.count !== 1) throw new Error("HANDOFF_IN_PROGRESS");

  try {
    const result = await createInscripcion(buildFinanceEnrollmentInput(enrollment));
    const shouldConfirm = purpose === "REGISTRATION_CONFIRMATION" && enrollment.status === "INTERESADO";
    await prisma.$transaction(async (tx) => {
      await tx.enrollment.update({
        where: { id: enrollment.id },
        data: {
          financeInscripcionId: result.id,
          financeStatus: "ENVIADO",
          lastHandoffError: null,
          ...(shouldConfirm ? { status: "INSCRITO" } : {}),
          ...(purpose === "COURSE_COMPLETION" ? { certificateStatus: "PENDIENTE" } : {}),
        },
      });
      if (shouldConfirm) {
        await tx.lead.updateMany({ where: { id: enrollment.leadId, stage: "NUEVO" }, data: { stage: "INSCRITO" } });
      }
      await tx.leadEvent.upsert({
        where: { idempotencyKey: `finance-handoff:${enrollment.id}` },
        update: { payload: { courseId: enrollment.courseId, financeInscripcionId: result.id } },
        create: {
          leadId: enrollment.leadId,
          enrollmentId: enrollment.id,
          type: "finance_handoff",
          idempotencyKey: `finance-handoff:${enrollment.id}`,
          payload: { courseId: enrollment.courseId, financeInscripcionId: result.id },
        },
      });
    });
    await writeAudit({
      session,
      action: "FINANCE_HANDOFF",
      entityType: "Enrollment",
      entityId: enrollment.id,
      metadata: { purpose, reused: false },
    }).catch(() => undefined);
    if (shouldConfirm) await scheduleEnrollmentAutomations(enrollment.id).catch(() => undefined);
    return {
      ok: true,
      simulated: false,
      financeInscripcionId: result.id,
      financeUrl: financeEnrollmentUrl(result.id),
      verifyUrl: financeVerificationUrl(result.id),
    };
  } catch (error) {
    const safeError = safeFinanceError(error);
    await prisma.enrollment.update({
      where: { id: enrollment.id },
      data: { financeStatus: "ERROR", lastHandoffError: safeError },
    });
    await writeAudit({
      session,
      action: "FINANCE_HANDOFF",
      entityType: "Enrollment",
      entityId: enrollment.id,
      result: "FAILURE",
      metadata: { purpose },
    });
    throw error;
  }
}

export async function confirmEnrollmentWithFinance(enrollmentId: string, session?: AdminSession | null) {
  return handoffEnrollment(enrollmentId, session, "REGISTRATION_CONFIRMATION");
}

export async function completeEnrollment(
  enrollmentId: string,
  source: "ADMIN" | "MOODLE",
  session?: AdminSession | null,
) {
  const enrollment = await prisma.enrollment.findUnique({ where: { id: enrollmentId } });
  if (!enrollment) throw new Error("ENROLLMENT_NOT_FOUND");
  const completedNow = await prisma.$transaction(async (tx) => {
    const claimed = await tx.enrollment.updateMany({
      where: { id: enrollment.id, status: { not: "COMPLETADO" } },
      data: {
        status: "COMPLETADO",
        moodleCompletionDate: source === "MOODLE" ? new Date() : undefined,
      },
    });
    if (claimed.count !== 1) return false;
    await tx.leadEvent.create({
      data: {
        leadId: enrollment.leadId,
        enrollmentId: enrollment.id,
        type: "course_completed",
        idempotencyKey: `completion:${enrollment.id}`,
        payload: { source },
      },
    });
    return true;
  });
  if (completedNow) {
    await writeAudit({
      session,
      action: "COURSE_COMPLETED",
      entityType: "Enrollment",
      entityId: enrollment.id,
      metadata: { source },
    });
  }

  /**
   * Aviso de finalizacion a la capa comercial de Finance.
   *
   * Va DESPUES de completar en local y nunca lo revierte: el alumno termino el
   * curso, y eso es cierto aunque una hoja de calculo no conteste. Un fallo
   * aqui queda registrado como sincronizacion pendiente y puede reintentarse
   * ejecutando esta misma funcion, que es idempotente porque el `claim` de
   * arriba solo deja pasar la primera vez.
   */
  await markCrmCourseCompleted({ crmEnrollmentId: enrollment.id, completionStatus: "completado", source })
    .then(async (resultado) => {
      if (resultado.ok) return;
      await writeAudit({
        session,
        action: "COURSE_COMPLETION_FINANCE_PENDING",
        entityType: "Enrollment",
        entityId: enrollment.id,
        result: "FAILURE",
        metadata: { source, motivo: resultado.error.slice(0, 200) },
      });
    })
    .catch(async (error: unknown) => {
      await writeAudit({
        session,
        action: "COURSE_COMPLETION_FINANCE_PENDING",
        entityType: "Enrollment",
        entityId: enrollment.id,
        result: "FAILURE",
        metadata: { source, motivo: error instanceof Error ? error.message.slice(0, 200) : "fallo desconocido" },
      });
    });

  return handoffEnrollment(enrollment.id, session);
}
