"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AdminEmptyState } from "../AdminEmptyState";
import { AdminIcon } from "../AdminIcon";

type ScoreItem = { label: string; points: number };
type SalesLead = {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  stage: string;
  score: number;
  breakdown: ScoreItem[];
  course: string | null;
  assignedTo: string | null;
  lostReason: string | null;
  nextActionAt: string | null;
};

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, data: await res.json() };
}

function LeadCard({
  lead,
  actions,
  busy,
  onStage,
}: {
  lead: SalesLead;
  actions: { label: string; stage: string; ghost?: boolean }[];
  busy: string | null;
  onStage: (id: string, stage: string) => void;
}) {
  return (
    <div className="sales-card">
      <div className="sales-card-head">
        <div>
          <div className="sales-name">{lead.fullName}</div>
          <div className="sales-meta">
            {lead.email}
            {lead.phone ? ` · ${lead.phone}` : ""}
          </div>
        </div>
        <div className="sales-score" title="Puntaje de venta">
          {lead.score}
        </div>
      </div>
      {lead.course && (
        <div className="sales-meta">
          {lead.course}
        </div>
      )}
      <div className="sales-meta">
        Responsable: {lead.assignedTo ?? "Sin asignar"}
      </div>
      {lead.nextActionAt && (
        <div className="sales-meta">
          Próxima acción: {new Date(lead.nextActionAt).toLocaleString("es-EC", { timeZone: "America/Guayaquil" })}
        </div>
      )}
      {lead.lostReason && <div className="muted">Motivo: {lead.lostReason}</div>}
      {lead.breakdown.length > 0 && (
        <ul className="sales-breakdown">
          {lead.breakdown.map((b) => (
            <li key={`${b.label}:${b.points}`}>
              <span>{b.label}</span>
              <span>+{b.points}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="sales-actions">
        {actions.map((a) => (
          <button
            type="button"
            key={a.stage}
            className={`btn-sm ${a.ghost ? "ghost" : ""}`}
            disabled={busy === lead.id}
            onClick={() => onStage(lead.id, a.stage)}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function VentasManager({
  oportunidades,
  clientes,
  perdidos,
}: {
  oportunidades: SalesLead[];
  clientes: SalesLead[];
  perdidos: SalesLead[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [recomputing, setRecomputing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onStage(leadId: string, stage: string) {
    let lostReason: string | undefined;
    if (stage === "PERDIDO") {
      lostReason = window.prompt("Motivo de pérdida (obligatorio)")?.trim();
      if (!lostReason) return;
    }
    const sensitive = stage === "CLIENTE" || stage === "PERDIDO";
    if (sensitive && !window.confirm(stage === "CLIENTE" ? "¿Confirmas que la negociación cerró como cliente? Esto no emite certificados." : "¿Confirmas el cierre como perdido?")) return;
    setBusy(leadId);
    const result = await postJson("/api/admin/leads/stage", { leadId, stage, lostReason, confirm: sensitive });
    setMsg(result.ok ? "Etapa actualizada y registrada en el historial." : result.data.error ?? "No se pudo actualizar la etapa.");
    setBusy(null);
    router.refresh();
  }

  async function recompute() {
    if (!window.confirm("¿Recalcular los puntajes de todos los contactos activos? Los que alcancen el umbral pueden pasar a oportunidad.")) return;
    setRecomputing(true);
    setMsg(null);
    const { data } = await postJson("/api/admin/scoring/recompute", { confirm: true });
    setMsg(
      `Recalculados ${data.total ?? 0} leads · ${data.promovidos ?? 0} nuevas oportunidades.`,
    );
    setRecomputing(false);
    router.refresh();
  }

  return (
    <>
      <div className="panel sales-toolbar-panel">
        <button className="btn-sm" type="button" onClick={recompute} disabled={recomputing}>
          {recomputing ? "Recalculando..." : "Recalcular puntajes"}
        </button>
        {msg && <span className="result-line">{msg}</span>}
      </div>

      <div className="sales-cols">
        <section className="sales-col">
          <h2>
            <AdminIcon name="activity" size={18} /> Oportunidades <span className="count">{oportunidades.length}</span>
          </h2>
          {oportunidades.length === 0 ? (
            <AdminEmptyState icon="activity" title="Sin oportunidades" description="Recalcula los puntajes o espera nuevas captaciones." />
          ) : (
            oportunidades.map((l) => (
              <LeadCard
                key={l.id}
                lead={l}
                busy={busy}
                onStage={onStage}
                actions={[
                  { label: "Marcar cliente", stage: "CLIENTE" },
                  { label: "Perdido", stage: "PERDIDO", ghost: true },
                ]}
              />
            ))
          )}
        </section>

        <section className="sales-col">
          <h2>
            <AdminIcon name="sales" size={18} /> Clientes <span className="count">{clientes.length}</span>
          </h2>
          {clientes.length === 0 ? (
            <AdminEmptyState icon="contacts" title="Aún no hay clientes" description="Los cierres confirmados aparecerán en esta columna." />
          ) : (
            clientes.map((l) => (
              <LeadCard
                key={l.id}
                lead={l}
                busy={busy}
                onStage={onStage}
                actions={[{ label: "Volver a oportunidad", stage: "OPORTUNIDAD", ghost: true }]}
              />
            ))
          )}
        </section>

        <section className="sales-col">
          <h2>
            <AdminIcon name="close" size={18} /> Perdidos <span className="count">{perdidos.length}</span>
          </h2>
          {perdidos.length === 0 ? (
            <AdminEmptyState icon="secure" title="Sin contactos perdidos" description="No hay negociaciones cerradas como perdidas." />
          ) : (
            perdidos.map((l) => (
              <LeadCard
                key={l.id}
                lead={l}
                busy={busy}
                onStage={onStage}
                actions={[{ label: "Reabrir", stage: "OPORTUNIDAD", ghost: true }]}
              />
            ))
          )}
        </section>
      </div>
    </>
  );
}
