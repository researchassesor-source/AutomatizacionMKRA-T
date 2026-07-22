import { prisma } from "@/lib/db";
import type { Lead } from "@prisma/client";
import { AdminNav } from "../AdminNav";
import { VentasManager } from "./VentasManager";
import { UMBRAL_OPORTUNIDAD } from "@/lib/scoring";

export const dynamic = "force-dynamic";

type ScoreItem = { label: string; points: number };

function toSalesLead(l: Lead & { course: { title: string } | null }) {
  const breakdown = Array.isArray(l.scoreBreakdown)
    ? (l.scoreBreakdown as unknown as ScoreItem[])
    : [];
  return {
    id: l.id,
    fullName: l.fullName,
    email: l.email,
    phone: l.phone,
    stage: l.stage,
    score: l.score,
    breakdown,
    course: l.course?.title ?? null,
  };
}

export default async function AdminVentas() {
  const [oportunidades, clientes, perdidos] = await Promise.all([
    prisma.lead.findMany({
      where: { stage: "OPORTUNIDAD" },
      orderBy: { score: "desc" },
      include: { course: true },
      take: 100,
    }),
    prisma.lead.findMany({
      where: { stage: "CLIENTE" },
      orderBy: { score: "desc" },
      include: { course: true },
      take: 100,
    }),
    prisma.lead.findMany({
      where: { stage: "PERDIDO" },
      orderBy: { updatedAt: "desc" },
      include: { course: true },
      take: 100,
    }),
  ]);

  return (
    <main className="container admin-shell">
      <AdminNav active="/admin/ventas" />
      <h1 style={{ marginTop: 0 }}>Pipeline de ventas</h1>
      <p className="muted" style={{ marginTop: -6 }}>
        Los leads con puntaje ≥ {UMBRAL_OPORTUNIDAD} (tipicamente los que
        completaron un curso gratuito) se convierten en oportunidades de venta
        del catalogo de pago.
      </p>

      <VentasManager
        oportunidades={oportunidades.map(toSalesLead)}
        clientes={clientes.map(toSalesLead)}
        perdidos={perdidos.map(toSalesLead)}
      />
    </main>
  );
}
