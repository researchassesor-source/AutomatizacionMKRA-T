"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
          <div className="muted" style={{ fontSize: "0.8rem" }}>
            {lead.email}
            {lead.phone ? ` · ${lead.phone}` : ""}
          </div>
        </div>
        <div className="sales-score" title="Puntaje de venta">
          {lead.score}
        </div>
      </div>
      {lead.course && (
        <div className="muted" style={{ fontSize: "0.8rem", marginTop: 4 }}>
          {lead.course}
        </div>
      )}
      {lead.breakdown.length > 0 && (
        <ul className="sales-breakdown">
          {lead.breakdown.map((b, i) => (
            <li key={i}>
              <span>{b.label}</span>
              <span>+{b.points}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="sales-actions">
        {actions.map((a) => (
          <button
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
    setBusy(leadId);
    await postJson("/api/admin/leads/stage", { leadId, stage });
    setBusy(null);
    router.refresh();
  }

  async function recompute() {
    setRecomputing(true);
    setMsg(null);
    const { data } = await postJson("/api/admin/scoring/recompute", {});
    setMsg(
      `Recalculados ${data.total ?? 0} leads · ${data.promovidos ?? 0} nuevas oportunidades.`,
    );
    setRecomputing(false);
    router.refresh();
  }

  return (
    <>
      <div className="panel">
        <button className="btn-sm" onClick={recompute} disabled={recomputing}>
          {recomputing ? "Recalculando..." : "Recalcular puntajes"}
        </button>
        {msg && <span className="result-line" style={{ marginLeft: 10 }}>{msg}</span>}
      </div>

      <div className="sales-cols">
        <section className="sales-col">
          <h2>
            🔥 Oportunidades <span className="count">{oportunidades.length}</span>
          </h2>
          {oportunidades.length === 0 ? (
            <p className="muted">Sin oportunidades. Recalcula o espera captaciones.</p>
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
            ✅ Clientes <span className="count">{clientes.length}</span>
          </h2>
          {clientes.length === 0 ? (
            <p className="muted">Aun no hay clientes.</p>
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
            ✖ Perdidos <span className="count">{perdidos.length}</span>
          </h2>
          {perdidos.length === 0 ? (
            <p className="muted">Sin leads perdidos.</p>
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
