import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { issueCertificate } from "@/lib/certificates";

export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().email(),
  courseSlug: z.string().min(1),
});

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

  try {
    const cert = await issueCertificate(lead.id, course.id);
    return NextResponse.json({ ok: true, folio: cert.folio }, { status: 201 });
  } catch (err) {
    console.error("[courses/complete] error", err);
    return NextResponse.json(
      { error: "No pudimos emitir tu certificado. Intenta de nuevo." },
      { status: 500 },
    );
  }
}
