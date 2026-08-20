import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/authorization";
import { FINANCE_HANDOFF_ROLES } from "@/lib/finance/authorization";
import { isFinanceConfigured, isFinanceSimulation, listActiveFinanceServices } from "@/lib/finance/client";

export const dynamic = "force-dynamic";

/**
 * Lista de Servicios activos de Finance, para el selector "Configurar
 * Finance" (sección R del release de estabilización).
 *
 * Servidor-a-servidor: el navegador nunca ve la URL, el usuario ni la
 * contraseña de Finance. La respuesta trae solo id/nombre/modalidad.
 */
export async function GET(request: Request) {
  const auth = await requireRole(request, FINANCE_HANDOFF_ROLES);
  if (auth.error) return auth.error;

  if (!isFinanceConfigured() || isFinanceSimulation()) {
    return NextResponse.json({ error: "Finance no está disponible en este momento.", errorCode: "FINANCE_NOT_AVAILABLE" }, { status: 503 });
  }

  try {
    const services = await listActiveFinanceServices();
    return NextResponse.json({ ok: true, services });
  } catch (error) {
    // classifyFinanceError ya reduce cualquier texto de Finance a un código
    // corto conocido antes de lanzar, pero esta es la última puerta antes del
    // navegador: nunca confiar en que la capa anterior lo hizo bien. Igual
    // que safeWordPressErrorCode para el catálogo de WordPress.
    const raw = error instanceof Error ? error.message : "";
    const code = /^FINANCE_[A-Z_]+$/.test(raw) ? raw : "FINANCE_REQUEST_FAILED";
    if (code === "FINANCE_AUTH_FAILED") {
      return NextResponse.json({ error: "Finance no está disponible en este momento.", errorCode: code }, { status: 503 });
    }
    return NextResponse.json({ error: "No se pudo obtener la lista de servicios de Finance.", errorCode: code }, { status: 502 });
  }
}
