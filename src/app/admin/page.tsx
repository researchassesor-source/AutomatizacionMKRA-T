import { prisma } from "@/lib/db";
import { AdminNav } from "./AdminNav";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const [leads, oportunidades, clientes, msgPend, postsProg, cuentas] =
    await Promise.all([
      prisma.lead.count(),
      prisma.lead.count({ where: { stage: "OPORTUNIDAD" } }),
      prisma.lead.count({ where: { stage: "CLIENTE" } }),
      prisma.outboundMessage.count({ where: { status: "PROGRAMADO" } }),
      prisma.socialPost.count({ where: { status: "PROGRAMADO" } }),
      prisma.socialAccount.count(),
    ]);

  const stats = [
    { n: leads, l: "Leads totales" },
    { n: oportunidades, l: "Oportunidades" },
    { n: clientes, l: "Clientes" },
    { n: msgPend, l: "Mensajes en cola" },
    { n: postsProg, l: "Posts programados" },
    { n: cuentas, l: "Cuentas de redes" },
  ];

  return (
    <main className="container admin-shell">
      <AdminNav active="/admin" />
      <h1 style={{ marginTop: 0 }}>Resumen</h1>
      <div className="stat-grid">
        {stats.map((s) => (
          <div className="stat" key={s.l}>
            <div className="n">{s.n}</div>
            <div className="l">{s.l}</div>
          </div>
        ))}
      </div>
      <p className="muted">
        Cola de nurture y publicaciones se procesan por cron. Ver{" "}
        <code>README.md</code> para configurar los endpoints programados.
      </p>
    </main>
  );
}
