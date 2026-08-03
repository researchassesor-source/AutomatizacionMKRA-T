import { requireRole } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

function csv(value: unknown): string {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

export async function GET(request: Request) {
  const auth = await requireRole(request, ["ADMIN", "VENTAS"]);
  if (auth.error) return auth.error;
  const leads = await prisma.lead.findMany({
    where: { isArchived: false, consent: true },
    orderBy: { createdAt: "desc" },
    include: { enrollments: { include: { course: true } }, assignedTo: true },
    take: 5000,
  });
  const rows = [
    ["Nombres", "Apellidos", "Correo", "WhatsApp", "Etapa", "Cursos", "Origen", "UTM source", "UTM medium", "UTM campaign", "UTM content", "UTM term", "Landing", "Referrer", "Responsable", "Fecha"].map(csv).join(","),
    ...leads.map((lead) =>
      [
        lead.firstName,
        lead.lastName,
        lead.email,
        lead.phone,
        lead.stage,
        lead.enrollments.map((item) => item.course.title).join(" | "),
        lead.source,
        lead.utmSource,
        lead.utmMedium,
        lead.utmCampaign,
        lead.utmContent,
        lead.utmTerm,
        lead.landingUrl,
        lead.referrer,
        lead.assignedTo?.name,
        lead.createdAt.toISOString(),
      ].map(csv).join(","),
    ),
  ];
  await writeAudit({ session: auth.session, action: "LEADS_EXPORTED", entityType: "Lead", metadata: { count: leads.length } });
  return new Response(`\uFEFF${rows.join("\r\n")}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="contactos-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
