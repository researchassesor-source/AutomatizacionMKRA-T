import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/authorization";
import { GESTION } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

/**
 * Búsqueda de contactos existentes para vincular una conversación de
 * WhatsApp (sección V del release de estabilización).
 *
 * Hallazgo: el modal de vinculación llamaba a GET /api/admin/leads, una ruta
 * que solo tiene POST -la búsqueda nunca funcionó, fallaba en silencio con
 * una lista vacía-. Se crea el endpoint que en realidad hacía falta, en vez
 * de agregar un GET genérico a una ruta pensada para alta manual.
 */
export async function GET(request: Request) {
  const auth = await requireRole(request, GESTION);
  if (auth.error) return auth.error;

  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ ok: true, contacts: [] });

  const contactos = await prisma.lead.findMany({
    where: {
      isArchived: false,
      OR: [
        { fullName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
      ],
    },
    select: { id: true, fullName: true, email: true, phone: true },
    orderBy: { updatedAt: "desc" },
    take: 8,
  });

  return NextResponse.json({
    ok: true,
    contacts: contactos.map((c) => ({
      id: c.id,
      fullName: c.fullName,
      email: c.email || null,
      // Parcial, igual que la lista de conversaciones: suficiente para
      // reconocer a alguien sin exponer el número completo en una búsqueda.
      phonePartial: c.phone ? `…${c.phone.slice(-4)}` : null,
    })),
  });
}
