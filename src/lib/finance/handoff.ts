import { prisma } from "@/lib/db";
import { createInscripcion, financeVerificationUrl, isFinanceConfigured, isFinanceSimulation } from "./client";
import { writeAudit } from "@/lib/audit";
import type { AdminSession } from "@/lib/auth/session";

export async function handoffEnrollment(enrollmentId: string, session?: AdminSession | null) {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: { lead: true, course: true },
  });
  if (!enrollment) throw new Error("ENROLLMENT_NOT_FOUND");
  if (enrollment.status !== "COMPLETADO") throw new Error("ENROLLMENT_NOT_COMPLETED");
  if (enrollment.financeInscripcionId) {
    return {
      ok: true,
      reused: true,
      simulated: false,
      financeInscripcionId: enrollment.financeInscripcionId,
      verifyUrl: financeVerificationUrl(enrollment.financeInscripcionId),
    };
  }

  if (isFinanceSimulation() || !isFinanceConfigured()) {
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
      return { ok: true, reused: true, simulated: true, financeInscripcionId: null, verifyUrl: "" };
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
    return { ok: true, simulated: true, financeInscripcionId: null, verifyUrl: "" };
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
    const result = await createInscripcion({
      clienteNombre: enrollment.lead.fullName,
      clienteEmail: enrollment.lead.email,
      clienteTelefono: enrollment.lead.phone ?? undefined,
      servicioNombre: enrollment.course.title,
      modalidad: "Virtual",
      monto: enrollment.course.price ? Number(enrollment.course.price) : 0,
      notas: `Inscripción CRM · ${enrollment.id}`,
    });
    await prisma.enrollment.update({
      where: { id: enrollment.id },
      data: {
        financeInscripcionId: result.id,
        financeStatus: "ENVIADO",
        certificateStatus: "PENDIENTE",
        lastHandoffError: null,
      },
    });
    await prisma.leadEvent.create({
      data: {
        leadId: enrollment.leadId,
        enrollmentId: enrollment.id,
        type: "finance_handoff",
        payload: { courseId: enrollment.courseId },
      },
    });
    await writeAudit({ session, action: "FINANCE_HANDOFF", entityType: "Enrollment", entityId: enrollment.id });
    return {
      ok: true,
      simulated: false,
      financeInscripcionId: result.id,
      verifyUrl: financeVerificationUrl(result.id),
    };
  } catch (error) {
    const safeError = error instanceof Error ? error.message.slice(0, 300) : "Error de integración";
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
    });
    throw error;
  }
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
  return handoffEnrollment(enrollment.id, session);
}
