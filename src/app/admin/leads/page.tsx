import { prisma } from "@/lib/db";
import { AdminNav } from "../AdminNav";

export const dynamic = "force-dynamic";

function fmt(d: Date) {
  return new Date(d).toLocaleString("es", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export default async function AdminLeads() {
  const leads = await prisma.lead.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { course: true },
  });

  return (
    <main className="container admin-shell">
      <AdminNav active="/admin/leads" />
      <h1 style={{ marginTop: 0 }}>Leads ({leads.length})</h1>

      <div className="panel">
        {leads.length === 0 ? (
          <p className="muted">Aun no hay leads. Comparte una landing de curso.</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Correo</th>
                  <th>WhatsApp</th>
                  <th>Etapa</th>
                  <th>Curso</th>
                  <th>Origen</th>
                  <th>Campana</th>
                  <th>Fecha</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.id}>
                    <td>{l.fullName}</td>
                    <td>{l.email}</td>
                    <td>{l.phone ?? "—"}</td>
                    <td>
                      <span className="pill info">{l.stage}</span>
                    </td>
                    <td>{l.course?.title ?? "—"}</td>
                    <td>{l.utmSource ?? l.source ?? "—"}</td>
                    <td>{l.utmCampaign ?? "—"}</td>
                    <td>{fmt(l.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
