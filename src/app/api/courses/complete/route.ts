import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  createInscripcion,
  financeVerificationUrl,
  isFinanceConfigured,
} from "@/lib/finance/client";

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

    await prisma.lead.update({
      where: { id: lead.id },
      data: { financeInscripcionId: id, stage: "CERTIFICADO" },
    });

    await prisma.leadEvent.create({
      data: {
        leadId: lead.id,
        type: "finance_handoff",
        payload: { inscripcionId: id, courseSlug: course.slug },
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
        subject: "Tu inscripcion quedo registrada",
        body: [
          `Hola ${nombre},`,
          "",
          `¡Felicidades por completar "${course.title}"!`,
          "RA-Training emitira tu certificado. Podras verificarlo aqui:",
          "",
          verifyUrl,
          "",
          "El equipo de RA-Training",
        ].join("\n"),
        status: "PROGRAMADO",
        scheduledAt: new Date(),
        sequenceKey: "certificado",
        stepKey: "handoff",
      },
    });

    return NextResponse.json({ ok: true, inscripcionId: id, verifyUrl }, { status: 201 });
  } catch (err) {
    console.error("[courses/complete] handoff error", err);
    return NextResponse.json(
      { error: "No pudimos registrar tu inscripcion. Intenta de nuevo." },
      { status: 502 },
    );
  }
}
