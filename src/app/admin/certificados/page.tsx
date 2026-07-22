import { prisma } from "@/lib/db";
import { AdminNav } from "../AdminNav";
import { financeVerificationUrl } from "@/lib/finance/client";

export const dynamic = "force-dynamic";

function fmt(d: Date) {
  return new Date(d).toLocaleString("es", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export default async function AdminCertificados() {
  const leads = await prisma.lead.findMany({
    where: { financeInscripcionId: { not: null } },
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: { course: true },
  });

  return (
    <main className="container admin-shell">
      <AdminNav active="/admin/certificados" />
      <h1 style={{ marginTop: 0 }}>Certificados / Handoffs ({leads.length})</h1>
      <p className="muted" style={{ marginTop: -6 }}>
        Los certificados son emitidos y verificados por{" "}
        <strong>ra-training-finance</strong>. Aqui ves los leads que MKRA-T
        entrego como inscripcion.
      </p>

      <div className="panel">
        {leads.length === 0 ? (
          <p className="muted">
            Aun no hay handoffs. Se crean cuando un lead completa un curso en el aula.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Inscripcion</th>
                  <th>Lead</th>
                  <th>Correo</th>
                  <th>Curso</th>
                  <th>Fecha</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <code>{l.financeInscripcionId}</code>
                    </td>
                    <td>{l.fullName}</td>
                    <td>{l.email}</td>
                    <td>{l.course?.title ?? "—"}</td>
                    <td>{fmt(l.updatedAt)}</td>
                    <td>
                      <a
                        className="btn-sm ghost"
                        href={financeVerificationUrl(l.financeInscripcionId!)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Verificar ↗
                      </a>
                    </td>
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
