import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  createInscripcion,
  emitCertificate,
  financeVerificationUrl,
  isAutoEmitEnabled,
  isFinanceConfigured,
} from "@/lib/finance/client";
import { rescoreLead } from "@/lib/scoring";

export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().email(),
  courseSlug: z.string().min(1),
});

/**
 * Finalizacion del curso = HANDOFF a ra-training-finance.
 * MKRA-T no emite el certificado: crea la inscripcion en finance (la fuente de
 * verdad), guarda la referencia en el lead y devuelve la URL de verificacion.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "datos invalidos" }, { status: 422 });
  }

  if (!isFinanceConfigured()) {
    return NextResponse.json(
      { error: "Integracion con finance no configurada (FINANCE_*)." },
      { status: 503 },
    );
  }

  const course = await prisma.course.findUnique({
    where: { slug: parsed.data.courseSlug },
  });
  if (!course) {
    return NextResponse.json({ error: "curso no encontrado" }, { status: 404 });
  }

  const lead = await prisma.lead.findFirst({
    where: { email: parsed.data.email.toLowerCase() },
  });
  if (!lead) {
    return NextResponse.json(
      { error: "No encontramos tu inscripcion. Registrate primero en el curso." },
      { status: 404 },
    );
  }

  // Si ya se hizo el handoff, reutiliza la inscripcion (idempotente).
  if (lead.financeInscripcionId) {
    return NextResponse.json({
      ok: true,
      inscripcionId: lead.financeInscripcionId,
      verifyUrl: financeVerificationUrl(lead.financeInscripcionId),
    });
  }

  try {
    const { id } = await createInscripcion({
      clienteNombre: lead.fullName,
      clienteEmail: lead.email,
      clienteTelefono: lead.phone ?? undefined,
      modalidad: "Virtual",
      monto: 0,
      notas: `Curso gratuito MKRA-T: ${course.title}`,
    });

    // Emision automatica opcional (por defecto manual: finance lo emite).
    let emitido = false;
    if (isAutoEmitEnabled()) {
      try {
        await emitCertificate(id);
        emitido = true;
      } catch (err) {
        // No bloqueamos el handoff si la emision automatica falla; queda manual.
        console.error("[courses/complete] auto-emit fallo", err);
      }
    }

    await prisma.lead.update({
      where: { id: lead.id },
      data: { financeInscripcionId: id, stage: "CERTIFICADO" },
    });

    await prisma.leadEvent.create({
      data: {
        leadId: lead.id,
        type: emitido ? "certificate_issued" : "finance_handoff",
        payload: { inscripcionId: id, courseSlug: course.slug, emitido },
      },
    });

    const verifyUrl = financeVerificationUrl(id);

    // Aviso al lead con el enlace de verificacion de finance.
    const nombre = lead.fullName.split(" ")[0] ?? lead.fullName;
    await prisma.outboundMessage.create({
      data: {
        leadId: lead.id,
        channel: "EMAIL",
        toAddress: lead.email,
        subject: emitido
          ? "🎓 Tu certificado esta listo"
          : "Tu inscripcion quedo registrada",
        body: [
          `Hola ${nombre},`,
          "",
          `¡Felicidades por completar "${course.title}"!`,
          emitido
            ? "Ya puedes ver y verificar tu certificado aqui:"
            : "RA-Training emitira tu certificado. Podras verificarlo aqui:",
          "",
          verifyUrl,
          "",
          "El equipo de RA-Training",
        ].join("\n"),
        status: "PROGRAMADO",
        scheduledAt: new Date(),
        sequenceKey: "certificado",
        stepKey: emitido ? "emitido" : "handoff",
      },
    });

    // Scoring: completar un curso es una senal fuerte; puede promover a OPORTUNIDAD.
    try {
      await rescoreLead(lead.id);
    } catch (err) {
      console.error("[courses/complete] rescoreLead fallo", err);
    }

    return NextResponse.json(
      { ok: true, inscripcionId: id, verifyUrl, emitido },
      { status: 201 },
    );
  } catch (err) {
    console.error("[courses/complete] handoff error", err);
    return NextResponse.json(
      { error: "No pudimos registrar tu inscripcion. Intenta de nuevo." },
      { status: 502 },
    );
  }
}
