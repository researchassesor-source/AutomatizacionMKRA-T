import { prisma } from "@/lib/db";
import type { AdminSession } from "@/lib/auth/session";
import { buildFinanceEnrollmentInput, confirmEnrollmentWithFinance } from "./handoff";

/**
 * Envío masivo de un curso a Finance (sección T del release de
 * estabilización): "Enviar curso a Finance" desde Contactos.
 *
 * Reutiliza el handoff canónico (confirmEnrollmentWithFinance) una
 * inscripción a la vez -- la idempotencia y el mapeo de errores ya viven ahí,
 * no se duplican aquí. Lo único nuevo es la clasificación previa y el
 * recorrido con concurrencia acotada.
 */

export type BulkPreviewStatus = "POR_ENVIAR" | "YA_VINCULADO" | "CANCELADO" | "REQUIERE_CONFIGURACION";

export type BulkPreviewItem = {
  enrollmentId: string;
  leadName: string;
  status: BulkPreviewStatus;
  motivo?: string;
};

export type BulkPreview = {
  courseId: string;
  courseTitle: string;
  total: number;
  porEnviar: number;
  yaVinculados: number;
  cancelados: number;
  requierenConfiguracion: number;
  items: BulkPreviewItem[];
};

async function clasificarInscripciones(courseId: string): Promise<{ courseTitle: string; items: BulkPreviewItem[] }> {
  const course = await prisma.course.findUnique({ where: { id: courseId }, select: { title: true } });
  if (!course) throw new Error("COURSE_NOT_FOUND");

  // Los cancelados se listan aparte (todos, no solo los del filtro de arriba)
  // para que el resumen sea honesto sobre el universo completo del curso.
  const cancelados = await prisma.enrollment.findMany({
    where: { courseId, status: "CANCELADO" },
    select: { id: true, lead: { select: { fullName: true } } },
  });

  const full = await prisma.enrollment.findMany({
    where: { courseId, status: { not: "CANCELADO" } },
    include: { lead: true, course: { include: { sessions: true } } },
  });

  const items: BulkPreviewItem[] = full.map((enrollment) => {
    if (enrollment.financeInscripcionId) {
      return { enrollmentId: enrollment.id, leadName: enrollment.lead.fullName, status: "YA_VINCULADO" };
    }
    try {
      buildFinanceEnrollmentInput(enrollment);
      return { enrollmentId: enrollment.id, leadName: enrollment.lead.fullName, status: "POR_ENVIAR" };
    } catch (error) {
      return {
        enrollmentId: enrollment.id,
        leadName: enrollment.lead.fullName,
        status: "REQUIERE_CONFIGURACION",
        motivo: error instanceof Error && error.message === "FINANCE_COURSE_MODALITY_MISSING"
          ? "El curso no tiene modalidad configurada."
          : "El curso no tiene fechas configuradas.",
      };
    }
  });

  for (const enrollment of cancelados) {
    items.push({ enrollmentId: enrollment.id, leadName: enrollment.lead.fullName, status: "CANCELADO" });
  }

  return { courseTitle: course.title, items };
}

export async function previewBulkFinanceHandoff(courseId: string): Promise<BulkPreview> {
  const { courseTitle, items } = await clasificarInscripciones(courseId);
  return {
    courseId,
    courseTitle,
    total: items.length,
    porEnviar: items.filter((i) => i.status === "POR_ENVIAR").length,
    yaVinculados: items.filter((i) => i.status === "YA_VINCULADO").length,
    cancelados: items.filter((i) => i.status === "CANCELADO").length,
    requierenConfiguracion: items.filter((i) => i.status === "REQUIERE_CONFIGURACION").length,
    items,
  };
}

/** Códigos que significan "Finance mismo no responde", no "este registro tiene un problema". */
const FALLAS_GLOBALES = new Set(["FINANCE_NOT_AVAILABLE", "FINANCE_AUTH_FAILED"]);

export type BulkExecuteResult = {
  courseId: string;
  total: number;
  enviados: number;
  fallidos: number;
  fallaGlobal: string | null;
  detalle: Array<{ enrollmentId: string; ok: boolean; codigo?: string }>;
};

const CONCURRENCIA = 3;

function lotes<T>(items: T[], tamano: number): T[][] {
  const resultado: T[][] = [];
  for (let i = 0; i < items.length; i += tamano) resultado.push(items.slice(i, i + tamano));
  return resultado;
}

/**
 * Ejecuta el envío para todo lo que la vista previa clasificó POR_ENVIAR.
 *
 * Recalcula la clasificación en el momento de ejecutar (no confía en una
 * lista que el cliente le pase de vuelta): el estado de cada inscripción
 * pudo cambiar entre que se mostró la vista previa y que se confirmó.
 *
 * Un fallo POR REGISTRO no detiene el lote (se sigue con los demás); un
 * fallo GLOBAL (Finance no disponible / autenticación) sí lo detiene, para
 * no reintentar contra un servicio caído inscripción por inscripción.
 */
export async function executeBulkFinanceHandoff(courseId: string, actor?: AdminSession | null): Promise<BulkExecuteResult> {
  const preview = await previewBulkFinanceHandoff(courseId);
  const objetivo = preview.items.filter((item) => item.status === "POR_ENVIAR");

  const detalle: BulkExecuteResult["detalle"] = [];
  let fallaGlobal: string | null = null;

  for (const lote of lotes(objetivo, CONCURRENCIA)) {
    if (fallaGlobal) break;
    const resultados = await Promise.allSettled(lote.map((item) => confirmEnrollmentWithFinance(item.enrollmentId, actor)));
    for (let i = 0; i < resultados.length; i++) {
      const resultado = resultados[i];
      const enrollmentId = lote[i].enrollmentId;
      if (resultado.status === "fulfilled") {
        detalle.push({ enrollmentId, ok: true });
        continue;
      }
      const codigo = resultado.reason instanceof Error ? resultado.reason.message : "FINANCE_REQUEST_FAILED";
      if (FALLAS_GLOBALES.has(codigo)) {
        fallaGlobal = codigo;
        detalle.push({ enrollmentId, ok: false, codigo });
        break;
      }
      detalle.push({ enrollmentId, ok: false, codigo });
    }
  }

  return {
    courseId,
    total: objetivo.length,
    enviados: detalle.filter((d) => d.ok).length,
    fallidos: detalle.filter((d) => !d.ok).length,
    fallaGlobal,
    detalle,
  };
}
