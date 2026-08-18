import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/authorization";
import { OPERACION } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

/**
 * Usuarios a los que se puede asignar una conversacion.
 *
 * Devuelve el minimo para pintar un desplegable: identificador, nombre y rol.
 * Ni el correo ni nada de la cuenta, porque para elegir un asesor no hacen
 * falta y una lista de usuarios es justo el sitio donde no conviene exponer de
 * mas.
 */
const ROLES_ASIGNABLES = ["ADMIN", "DIRECCION", "MARKETING", "VENTAS"] as const;

export async function GET(request: Request) {
  const auth = await requireRole(request, OPERACION);
  if (auth.error) return auth.error;

  const usuarios = await prisma.adminUser.findMany({
    // Solo activos: asignar a alguien dado de baja deja la conversacion sin
    // dueno real y nadie se entera hasta que el contacto reclama.
    where: { isActive: true, role: { in: [...ROLES_ASIGNABLES] } },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
    take: 100,
  });

  return NextResponse.json({ ok: true, users: usuarios });
}
