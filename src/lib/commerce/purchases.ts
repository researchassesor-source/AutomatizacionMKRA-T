import { Prisma } from "@prisma/client";
import type { CoursePurchase, CoursePurchaseType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { scheduleEnrollmentAutomations, sendDueMessagesForEnrollment } from "@/lib/nurture/engine";
import { getCrmPurchaseStatus, importCrmPurchase } from "@/lib/finance/commerce";
import { resolverDerecho, validarCompraNueva } from "./entitlement";

/**
 * Compras del curso de 60 horas: persistencia y sincronizacion con Finance.
 *
 * La regla que gobierna todo el archivo: registrar la compra en Finance y
 * cobrarla son hechos distintos. `importCrmPurchase` solo confirma que la fila
 * existe; el derecho de acceso lo concede unicamente un `paymentStatus`
 * verificado. Confundirlos daria el curso gratis a quien solo inicio el pago.
 */

/**
 * Estados de pago del contrato de Finance. No hay mas.
 *
 * Se listan los cuatro para dejar constancia de que se conocen, pero solo
 * `PAYMENT_VERIFIED` concede nada. Antes tambien se aceptaban "VERIFICADO",
 * "PAGADO" y "VERIFIED" por si acaso, y eso era peligroso: ninguno pertenece al
 * contrato, asi que un valor inesperado con esa forma habria concedido acceso a
 * un curso sin que Finance lo hubiera confirmado nunca. Ante un estado que no
 * reconocemos, no conceder.
 */
export const ESTADOS_DE_PAGO = ["PAYMENT_PENDING", "PAYMENT_REPORTED", "PAYMENT_VERIFIED", "PAYMENT_CANCELLED"] as const;

export function esPagoVerificado(paymentStatus: string | null | undefined): boolean {
  return paymentStatus?.trim().toUpperCase() === "PAYMENT_VERIFIED";
}

export type ResultadoCompra =
  | { ok: true; compra: CoursePurchase }
  | { ok: false; codigo: string; mensaje: string };

/**
 * Recalcula derecho y nivel a partir de TODAS las compras de la inscripcion.
 *
 * Se recalcula desde cero en lugar de ir sumando: asi una compra cancelada o
 * corregida no deja un derecho colgado que nadie sabria de donde salio. El
 * acceso nunca se retira aqui —quien ya entro al curso no puede perderlo por
 * una reconsulta— pero el nivel si refleja siempre el estado real.
 */
export async function recalcularDerecho(enrollmentId: string, tx: Prisma.TransactionClient = prisma) {
  const compras = await tx.coursePurchase.findMany({
    where: { enrollmentId },
    select: { id: true, offerType: true, status: true, parentPurchaseId: true },
  });
  const derecho = resolverDerecho(compras);
  const actual = await tx.enrollment.findUnique({
    where: { id: enrollmentId },
    select: { fullCourseAccessEntitled: true, fullCourseAccessEntitledAt: true },
  });
  const concedeAhora = derecho.accesoCursoCompleto && !actual?.fullCourseAccessEntitled;
  await tx.enrollment.update({
    where: { id: enrollmentId },
    data: {
      effectiveCertificationTier: derecho.tier,
      // Nunca se revoca: si ya tenia acceso, se conserva aunque una consulta
      // posterior devuelva menos. Quitarlo por un fallo de red seria peor que
      // dejarlo de mas.
      fullCourseAccessEntitled: derecho.accesoCursoCompleto || Boolean(actual?.fullCourseAccessEntitled),
      fullCourseAccessEntitledAt: concedeAhora ? new Date() : actual?.fullCourseAccessEntitledAt ?? null,
    },
  });
  return derecho;
}

export type DatosCompra = {
  enrollmentId: string;
  offerType: CoursePurchaseType;
  amount: number;
  parentPurchaseId?: string | null;
};

/**
 * Crea la compra y la registra en Finance.
 *
 * La creacion local y el registro remoto se separan a proposito: si Finance
 * falla, la compra queda en ERROR con el motivo y puede reintentarse, en vez
 * de perderse. Lo que NO ocurre en ningun caso es conceder derecho.
 */
export async function crearCompra(datos: DatosCompra, actor?: { email?: string | null }): Promise<ResultadoCompra> {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: datos.enrollmentId },
    include: { lead: true, course: true, purchases: true },
  });
  if (!enrollment) return { ok: false, codigo: "ENROLLMENT_NO_EXISTE", mensaje: "La inscripción no existe." };

  const problema = validarCompraNueva(
    { offerType: datos.offerType, parentPurchaseId: datos.parentPurchaseId },
    enrollment.purchases.map((compra) => ({
      id: compra.id,
      offerType: compra.offerType,
      status: compra.status,
      parentPurchaseId: compra.parentPurchaseId,
    })),
  );
  if (problema) return { ok: false, codigo: problema.codigo, mensaje: problema.mensaje };

  const compra = await prisma.coursePurchase.create({
    data: {
      enrollmentId: enrollment.id,
      offerType: datos.offerType,
      amount: new Prisma.Decimal(datos.amount),
      parentPurchaseId: datos.parentPurchaseId ?? null,
      status: "PENDING",
    },
  });

  await writeAudit({
    actorEmail: actor?.email ?? "sistema",
    action: "COURSE_PURCHASE_CREATED",
    entityType: "CoursePurchase",
    entityId: compra.id,
    result: "SUCCESS",
    metadata: { enrollmentId: enrollment.id, offerType: datos.offerType, amount: datos.amount },
  });

  const sincronizada = await sincronizarConFinance(compra.id);
  return sincronizada ?? { ok: true, compra };
}

/** Registra en Finance una compra ya creada. Idempotente por `crmOrderId`. */
export async function sincronizarConFinance(purchaseId: string): Promise<ResultadoCompra | null> {
  const compra = await prisma.coursePurchase.findUnique({
    where: { id: purchaseId },
    include: { enrollment: { include: { lead: true, course: true } }, parent: true },
  });
  if (!compra) return { ok: false, codigo: "COMPRA_NO_EXISTE", mensaje: "La compra no existe." };

  const { enrollment } = compra;
  const resultado = await importCrmPurchase({
    // El identificador de la compra ES el CRMOrderID: reenviar la misma compra
    // no crea una segunda fila en Finance.
    crmOrderId: compra.id,
    crmEnrollmentId: enrollment.id,
    crmContactId: enrollment.leadId,
    crmCourseId: enrollment.courseId,
    courseTitle: enrollment.course.title,
    modality: enrollment.course.modality,
    startDate: enrollment.course.startsAt?.toISOString() ?? null,
    endDate: enrollment.course.endsAt?.toISOString() ?? null,
    participant: {
      fullName: enrollment.lead.fullName,
      firstName: enrollment.lead.firstName,
      lastName: enrollment.lead.lastName,
      email: enrollment.lead.email,
      phone: enrollment.lead.phone,
      identification: null,
    },
    offerType: compra.offerType,
    parentCrmOrderId: compra.parentPurchaseId ?? undefined,
    amount: Number(compra.amount),
  }).catch((error: unknown) => ({ ok: false as const, error: error instanceof Error ? error.message.slice(0, 200) : "fallo desconocido" }));

  if (!resultado.ok) {
    const conError = await prisma.coursePurchase.update({
      where: { id: compra.id },
      data: { status: "ERROR", lastFinanceError: resultado.error.slice(0, 300), lastFinanceSyncAt: new Date() },
    });
    return { ok: true, compra: conError };
  }

  // Registrada, NO pagada. El estado refleja exactamente eso.
  const actualizada = await prisma.coursePurchase.update({
    where: { id: compra.id },
    data: {
      status: "SENT_TO_FINANCE",
      financeInscripcionId: resultado.datos.financeInscripcionId,
      lastFinanceError: null,
      lastFinanceSyncAt: new Date(),
    },
  });
  return { ok: true, compra: actualizada };
}

/**
 * Reconsulta el pago en Finance y aplica el resultado.
 *
 * Es el unico camino por el que una compra llega a PAYMENT_VERIFIED, y por
 * tanto el unico por el que se concede el derecho de acceso.
 */
export async function refrescarPago(purchaseId: string): Promise<ResultadoCompra> {
  const compra = await prisma.coursePurchase.findUnique({ where: { id: purchaseId } });
  if (!compra) return { ok: false, codigo: "COMPRA_NO_EXISTE", mensaje: "La compra no existe." };

  const resultado = await getCrmPurchaseStatus(compra.id)
    .catch((error: unknown) => ({ ok: false as const, error: error instanceof Error ? error.message.slice(0, 200) : "fallo desconocido" }));

  if (!resultado.ok) {
    const conError = await prisma.coursePurchase.update({
      where: { id: compra.id },
      data: { lastFinanceError: resultado.error.slice(0, 300), lastFinanceSyncAt: new Date() },
    });
    // Fail closed: sin respuesta de Finance no se concede nada.
    return { ok: true, compra: conError };
  }

  const verificado = esPagoVerificado(resultado.datos.paymentStatus);
  const actualizada = await prisma.$transaction(async (tx) => {
    const guardada = await tx.coursePurchase.update({
      where: { id: compra.id },
      data: {
        status: verificado ? "PAYMENT_VERIFIED" : "PAYMENT_PENDING",
        financePaymentStatus: resultado.datos.paymentStatus.slice(0, 60),
        paymentVerifiedAt: verificado
          ? (resultado.datos.paymentVerifiedAt ? new Date(resultado.datos.paymentVerifiedAt) : new Date())
          : null,
        lastFinanceError: null,
        lastFinanceSyncAt: new Date(),
      },
    });
    await recalcularDerecho(compra.enrollmentId, tx);
    return guardada;
  });

  if (verificado) {
    await writeAudit({
      actorEmail: "finance-sync",
      action: "COURSE_PURCHASE_PAYMENT_VERIFIED",
      entityType: "CoursePurchase",
      entityId: compra.id,
      result: "SUCCESS",
      metadata: { enrollmentId: compra.enrollmentId, offerType: compra.offerType },
    });
    await activarJourney(compra.enrollmentId);
  }
  return { ok: true, compra: actualizada };
}

/**
 * Arranca el journey de una inscripcion recien pagada.
 *
 * Va FUERA de la transaccion del pago y a proposito. El pago es el hecho
 * importante: si el proveedor de mensajeria esta caido, lo que no puede pasar
 * es que se pierda un cobro verificado. Por eso aqui no se propaga ningun
 * error; se deja escrito en la auditoria y la reconciliacion del reloj lo
 * recoge en la siguiente vuelta.
 *
 * Sin esto, quien pagaba quedaba con el derecho concedido pero sin bienvenida:
 * el reloj programa por reglas vencidas, y una bienvenida es inmediata, asi que
 * su momento ya habia pasado cuando el reloj miraba.
 */
async function activarJourney(enrollmentId: string) {
  try {
    await scheduleEnrollmentAutomations(enrollmentId);
    // La bienvenida se programa para "ahora": sin este paso esperaria al
    // siguiente tick para salir.
    await sendDueMessagesForEnrollment(enrollmentId);
  } catch (error: unknown) {
    await writeAudit({
      actorEmail: "finance-sync",
      action: "ENROLLMENT_JOURNEY_ACTIVATION_FAILED",
      entityType: "Enrollment",
      entityId: enrollmentId,
      result: "FAILURE",
      // Solo el motivo, recortado: aqui no entra nada del proveedor ni del contacto.
      metadata: { error: error instanceof Error ? error.message.slice(0, 200) : "fallo desconocido" },
    }).catch(() => undefined);
  }
}

/**
 * Mejora con aval externo sobre una compra institucional ya pagada.
 *
 * No crea inscripcion ni concede acceso nuevo: el acceso ya existe. Lo unico
 * que cambia al verificarse el pago es el nivel de certificacion.
 */
export async function crearUpgrade(
  enrollmentId: string,
  amount: number,
  actor?: { email?: string | null },
): Promise<ResultadoCompra> {
  const institucional = await prisma.coursePurchase.findFirst({
    where: { enrollmentId, offerType: "INSTITUTIONAL", status: "PAYMENT_VERIFIED" },
    orderBy: { createdAt: "desc" },
  });
  if (!institucional) {
    return {
      ok: false,
      codigo: "SIN_INSTITUCIONAL_PAGADA",
      mensaje: "La mejora con aval solo puede crearse sobre una compra institucional con el pago ya verificado.",
    };
  }
  return crearCompra({ enrollmentId, offerType: "AVAL_UPGRADE", amount, parentPurchaseId: institucional.id }, actor);
}
