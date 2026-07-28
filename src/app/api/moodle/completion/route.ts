import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { completeEnrollment } from "@/lib/finance/handoff";
import { PayloadTooLargeError, readJsonBody } from "@/lib/http";
import { moodleCompletionSchema } from "@/lib/moodle";

function authorized(request: Request): boolean {
  const secret = process.env.MOODLE_WEBHOOK_SECRET;
  if (!secret) return false;
  const supplied = request.headers.get("x-moodle-webhook-secret");
  if (!supplied || supplied.length !== secret.length) return false;
  let mismatch = 0;
  for (let index = 0; index < secret.length; index++) {
    mismatch |= supplied.charCodeAt(index) ^ secret.charCodeAt(index);
  }
  return mismatch === 0;
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  let body: unknown;
  try {
    body = await readJsonBody(request, 16_384);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return NextResponse.json({ error: "La solicitud es demasiado grande." }, { status: 413 });
    }
    return NextResponse.json({ error: "Datos no válidos." }, { status: 422 });
  }
  const parsed = moodleCompletionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos no válidos." }, { status: 422 });

  const idempotencyKey = `moodle:${parsed.data.eventId}`;
  const repeated = await prisma.leadEvent.findFirst({ where: { idempotencyKey } });
  if (repeated?.enrollmentId) {
    if (repeated.enrollmentId !== parsed.data.enrollmentId) {
      return NextResponse.json({ error: "El evento ya fue utilizado." }, { status: 409 });
    }
    const result = await completeEnrollment(repeated.enrollmentId, "MOODLE");
    return NextResponse.json({ ...result, duplicate: true });
  }
  if (repeated) return NextResponse.json({ error: "El evento ya fue utilizado." }, { status: 409 });

  const enrollment = await prisma.enrollment.findUnique({
    where: { id: parsed.data.enrollmentId },
    include: { lead: { select: { email: true } }, course: { select: { slug: true } } },
  });
  if (!enrollment || enrollment.lead.email !== parsed.data.email || enrollment.course.slug !== parsed.data.courseSlug) {
    return NextResponse.json({ error: "No se encontró la inscripción." }, { status: 404 });
  }
  if (enrollment.moodleEnrollmentId && enrollment.moodleEnrollmentId !== parsed.data.moodleEnrollmentId) {
    return NextResponse.json({ error: "La referencia de Moodle no coincide." }, { status: 409 });
  }

  try {
    await prisma.$transaction([
      prisma.enrollment.update({
        where: { id: enrollment.id },
        data: { moodleEnrollmentId: parsed.data.moodleEnrollmentId ?? enrollment.moodleEnrollmentId },
      }),
      prisma.leadEvent.create({
        data: {
          leadId: enrollment.leadId,
          enrollmentId: enrollment.id,
          type: "moodle_completion_received",
          idempotencyKey,
        },
      }),
    ]);
  } catch {
    const duplicate = await prisma.leadEvent.findFirst({ where: { idempotencyKey } });
    if (duplicate?.enrollmentId) {
      if (duplicate.enrollmentId !== parsed.data.enrollmentId) {
        return NextResponse.json({ error: "El evento ya fue utilizado." }, { status: 409 });
      }
      const result = await completeEnrollment(duplicate.enrollmentId, "MOODLE");
      return NextResponse.json({ ...result, duplicate: true });
    }
    return NextResponse.json({ error: "No se pudo registrar la finalización." }, { status: 409 });
  }
  return NextResponse.json(await completeEnrollment(enrollment.id, "MOODLE"));
}
