import { prisma } from "@/lib/db";
import { AdminNav } from "../AdminNav";
import { DispatchButton } from "./DispatchButton";

export const dynamic = "force-dynamic";

const statusClass: Record<string, string> = {
  PROGRAMADO: "warn",
  ENVIANDO: "info",
  ENVIADO: "ok",
  FALLIDO: "err",
  OMITIDO: "",
};

function fmt(d: Date | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("es", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export default async function AdminMensajes() {
  const messages = await prisma.outboundMessage.findMany({
    orderBy: { scheduledAt: "asc" },
    take: 100,
    include: { lead: true },
  });

  return (
    <main className="container admin-shell">
      <AdminNav active="/admin/mensajes" />
      <h1 style={{ marginTop: 0 }}>Nurture · mensajes</h1>

      <div className="panel">
        <h2>Cola de envio</h2>
        <p className="muted" style={{ marginTop: -6 }}>
          En produccion esto lo procesa un cron. Aqui puedes forzar el envio de
          lo que ya esta vencido.
        </p>
        <DispatchButton />
      </div>

      <div className="panel">
        {messages.length === 0 ? (
          <p className="muted">
            Sin mensajes todavia. Se generan al inscribirse un lead.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Canal</th>
                  <th>Lead</th>
                  <th>Para</th>
                  <th>Paso</th>
                  <th>Asunto</th>
                  <th>Estado</th>
                  <th>Programado</th>
                  <th>Enviado</th>
                </tr>
              </thead>
              <tbody>
                {messages.map((m) => (
                  <tr key={m.id}>
                    <td>{m.channel}</td>
                    <td>{m.lead.fullName}</td>
                    <td>{m.toAddress}</td>
                    <td>
                      {m.sequenceKey}/{m.stepKey}
                    </td>
                    <td>{m.subject ?? "—"}</td>
                    <td>
                      <span className={`pill ${statusClass[m.status] ?? ""}`}>
                        {m.status}
                      </span>
                      {m.error && (
                        <div className="muted" style={{ maxWidth: 220 }}>
                          {m.error}
                        </div>
                      )}
                    </td>
                    <td>{fmt(m.scheduledAt)}</td>
                    <td>{fmt(m.sentAt)}</td>
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
