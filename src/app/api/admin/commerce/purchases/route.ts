import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/authorization";
import { COMERCIAL } from "@/lib/auth/roles";
import { prisma } from "@/lib/db";
import { crearCompra, crearUpgrade, refrescarPago } from "@/lib/commerce/purchases";

export const dynamic = "force-dynamic";

/**
 * Compras del curso de 60 horas.
 *
 * GET  -> compras y derecho vigente de una inscripcion.
 * POST -> crear una compra, crear la mejora con aval, o reconsultar el pago.
 *
 * Ninguna de estas acciones concede acceso por si misma: el derecho lo aplica
 * `refrescarPago` y solo cuando Finance confirma el pago.
 */

const accionSchema = z.discriminatedUnion("accion", [
  z.object({
    accion: z.literal("crear"),
    enrollmentId: z.string().min(1),
    offerType: z.enum(["FULL", "INSTITUTIONAL"]),
    amount: z.number().positive().max(100_000),
  }),
  z.object({ accion: z.literal("upgrade"), enrollmentId: z.string().min(1), amount: z.number().positive().max(100_000) }),
  z.object({ accion: z.literal("refrescar"), purchaseId: z.string().min(1) }),
]);

export async function GET(request: Request) {
  const auth = await requireRole(request, COMERCIAL);
  if (auth.error) return auth.error;

  const enrollmentId = new URL(request.url).searchParams.get("enrollmentId")?.trim();
  if (!enrollmentId) return NextResponse.json({ error: "Indica la inscripción." }, { status: 422 });

  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    select: {
      id: true,
      effectiveCertificationTier: true,
      fullCourseAccessEntitled: true,
      fullCourseAccessEntitledAt: true,
      purchases: {
        select: {
          id: true, offerType: true, status: true, amount: true, parentPurchaseId: true,
          financeInscripcionId: true, financePaymentStatus: true, paymentVerifiedAt: true,
          lastFinanceError: true, lastFinanceSyncAt: true, createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!enrollment) return NextResponse.json({ error: "La inscripción no existe." }, { status: 404 });

  return NextResponse.json({
    ok: true,
    tier: enrollment.effectiveCertificationTier,
    accesoCursoCompleto: enrollment.fullCourseAccessEntitled,
    accesoDesde: enrollment.fullCourseAccessEntitledAt?.toISOString() ?? null,
    compras: enrollment.purchases.map((compra) => ({
      ...compra,
      amount: Number(compra.amount),
      paymentVerifiedAt: compra.paymentVerifiedAt?.toISOString() ?? null,
      lastFinanceSyncAt: compra.lastFinanceSyncAt?.toISOString() ?? null,
      createdAt: compra.createdAt.toISOString(),
    })),
  });
}

export async function POST(request: Request) {
  const auth = await requireRole(request, COMERCIAL);
  if (auth.error) return auth.error;
  // `requireRole` devuelve la sesion aparte del error; sin esta comprobacion
  // TypeScript no puede saber que aqui ya existe.
  if (!auth.session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const parsed = accionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Datos no válidos." }, { status: 422 });
  }
  const datos = parsed.data;
  const actor = { email: auth.session.email };

  const resultado = datos.accion === "crear"
    ? await crearCompra({ enrollmentId: datos.enrollmentId, offerType: datos.offerType, amount: datos.amount }, actor)
    : datos.accion === "upgrade"
      ? await crearUpgrade(datos.enrollmentId, datos.amount, actor)
      : await refrescarPago(datos.purchaseId);

  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.mensaje, codigo: resultado.codigo }, { status: 422 });
  }
  return NextResponse.json({
    ok: true,
    compra: {
      id: resultado.compra.id,
      offerType: resultado.compra.offerType,
      status: resultado.compra.status,
      // Se devuelve explicito para que nadie confunda "registrada" con "pagada".
      pagoVerificado: resultado.compra.status === "PAYMENT_VERIFIED",
      lastFinanceError: resultado.compra.lastFinanceError,
    },
  });
}
