import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/authorization";
import { CONTENIDO } from "@/lib/auth/roles";
import { prisma } from "@/lib/db";
import { proponerCalendario } from "@/lib/course-schedule-parser";

export const dynamic = "force-dynamic";

/**
 * Lee la ficha publica del curso y PROPONE un calendario.
 *
 * Solo lee. No crea ninguna sesion: una fecha mal interpretada programaria
 * recordatorios reales en el dia equivocado, asi que la propuesta siempre pasa
 * por una confirmacion humana con los valores a la vista y editables.
 *
 * La URL no la elige quien llama: se toma del curso en la base, y solo se
 * acepta el dominio oficial. Asi esta ruta no puede convertirse en un
 * mecanismo para hacer peticiones a servidores ajenos desde el servidor.
 */
const DOMINIO_OFICIAL = "ra-training.com";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, CONTENIDO);
  if (auth.error) return auth.error;
  const { id } = await params;

  const course = await prisma.course.findUnique({
    where: { id },
    select: { id: true, title: true, officialUrl: true, officialCourseUrl: true },
  });
  if (!course) return NextResponse.json({ error: "No se encontró el curso." }, { status: 404 });

  const raw = course.officialUrl ?? course.officialCourseUrl;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return NextResponse.json({ ok: false, motivo: "El curso no tiene una dirección web válida." });
  }
  if (url.protocol !== "https:" || (url.hostname !== DOMINIO_OFICIAL && url.hostname !== `www.${DOMINIO_OFICIAL}`)) {
    return NextResponse.json({ ok: false, motivo: "La dirección del curso no pertenece al sitio oficial." });
  }

  let html: string;
  try {
    const response = await fetch(url.toString(), {
      redirect: "follow",
      headers: { "User-Agent": "RA-Training-CRM/1.0" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      return NextResponse.json({ ok: false, motivo: `La página del curso respondió ${response.status}.` });
    }
    html = await response.text();
  } catch {
    return NextResponse.json({ ok: false, motivo: "No se pudo abrir la página del curso." });
  }

  const propuesta = proponerCalendario(html);
  return NextResponse.json({ ...propuesta, courseTitle: course.title, sourceUrl: url.toString() });
}
