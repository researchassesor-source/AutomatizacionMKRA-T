import { requireRole } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { COMERCIAL, isTechnicalProfile } from "@/lib/auth/roles";

/**
 * Exportacion de contactos.
 *
 * Direccion recibe una hoja legible: nombres en español, fechas en horario de
 * Ecuador y solo columnas con informacion. Las de atribucion (UTM, responsable)
 * estaban vacias en los 31 contactos, asi que ocupaban ancho sin decir nada.
 *
 * La exportacion completa sigue existiendo para el perfil tecnico: `?tecnica=1`
 * añade los campos crudos cuando hace falta cruzarlos con otra herramienta.
 */
function csv(value: unknown): string {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

const fechaEcuador = new Intl.DateTimeFormat("es-EC", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "America/Guayaquil",
});

/** "08/08/2026 19:51": lo que espera quien abre la hoja, no un ISO en UTC. */
function momento(value: Date | null): string {
  if (!value) return "";
  return fechaEcuador.format(value).replace(",", "");
}

const ETAPAS: Record<string, string> = {
  NUEVO: "Interés registrado",
  INSCRITO: "Inscrito",
  EN_CURSO: "En curso",
  CERTIFICADO: "Certificado",
  OPORTUNIDAD: "Oportunidad",
  CLIENTE: "Cliente",
  PERDIDO: "Perdido",
};

const INSCRIPCION: Record<string, string> = {
  INTERESADO: "Interés registrado",
  INSCRITO: "Inscrito",
  EN_CURSO: "En curso",
  COMPLETADO: "Completado",
  CANCELADO: "Cancelado",
};

export async function GET(request: Request) {
  const auth = await requireRole(request, COMERCIAL);
  if (auth.error) return auth.error;

  const tecnica = new URL(request.url).searchParams.get("tecnica") === "1"
    && auth.session !== null
    && isTechnicalProfile(auth.session.role);

  const leads = await prisma.lead.findMany({
    where: { isArchived: false, consent: true },
    orderBy: { createdAt: "desc" },
    include: { enrollments: { include: { course: true } } },
    take: 5000,
  });

  const cabecera = tecnica
    ? ["Nombres", "Apellidos", "Correo", "WhatsApp", "Situación", "Cursos", "Página de origen", "Procedencia", "Fecha de registro", "Origen", "UTM source", "UTM medium", "UTM campaign", "UTM content", "UTM term"]
    : ["Nombres", "Apellidos", "Correo", "WhatsApp", "Situación", "Cursos", "Fecha de registro"];

  const filas = leads.map((lead) => {
    // Un contacto puede estar en varios cursos con situaciones distintas.
    const cursos = lead.enrollments
      .map((item) => `${item.course.title} (${INSCRIPCION[item.status] ?? item.status})`)
      .join(" · ");
    const base = [
      lead.firstName ?? lead.fullName,
      lead.lastName ?? "",
      lead.email,
      // El teléfono ya se guarda normalizado como +5939…
      lead.phone ?? "",
      ETAPAS[lead.stage] ?? lead.stage,
      cursos,
    ];
    return tecnica
      ? [...base, lead.landingUrl ?? "", lead.referrer ?? "", momento(lead.createdAt), lead.source ?? "", lead.utmSource ?? "", lead.utmMedium ?? "", lead.utmCampaign ?? "", lead.utmContent ?? "", lead.utmTerm ?? ""]
      : [...base, momento(lead.createdAt)];
  });

  const cuerpo = [cabecera.map(csv).join(","), ...filas.map((fila) => fila.map(csv).join(","))].join("\r\n");

  await writeAudit({
    session: auth.session,
    action: "LEADS_EXPORTED",
    entityType: "Lead",
    metadata: { total: leads.length, modo: tecnica ? "tecnica" : "direccion" },
  });

  // BOM para que Excel reconozca UTF-8 y no rompa las tildes.
  return new Response(`﻿${cuerpo}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="contactos-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
