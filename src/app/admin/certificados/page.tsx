import { prisma } from "@/lib/db";
import { AdminNav } from "../AdminNav";

export const dynamic = "force-dynamic";

function fmt(d: Date) {
  return new Date(d).toLocaleString("es", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export default async function AdminCertificados() {
  const certs = await prisma.certificate.findMany({
    orderBy: { issuedAt: "desc" },
    take: 100,
  });

  return (
    <main className="container admin-shell">
      <AdminNav active="/admin/certificados" />
      <h1 style={{ marginTop: 0 }}>Certificados ({certs.length})</h1>

      <div className="panel">
        {certs.length === 0 ? (
          <p className="muted">
            Aun no se han emitido certificados. Se emiten cuando un lead
            completa un curso en el aula.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Folio</th>
                  <th>Titular</th>
                  <th>Curso</th>
                  <th>Tipo</th>
                  <th>Emitido</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {certs.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <code>{c.folio}</code>
                    </td>
                    <td>{c.holderName}</td>
                    <td>{c.courseTitle}</td>
                    <td>
                      <span className={`pill ${c.official ? "ok" : ""}`}>
                        {c.official ? "Oficial" : "Constancia"}
                      </span>
                    </td>
                    <td>{fmt(c.issuedAt)}</td>
                    <td>
                      <a
                        className="btn-sm ghost"
                        href={`/verificar/${c.folio}`}
                        target="_blank"
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
