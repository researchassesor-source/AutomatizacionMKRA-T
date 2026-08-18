"use client";

import { useState } from "react";

type Conteo = { bodyParams: number; headerParams: number; buttonParams: number };
type Fila = {
  key: string;
  name: string;
  language: string;
  metaStatus: string | null;
  category: string | null;
  parameterFormat: string | null;
  codigo: Conteo;
  meta: Conteo | null;
  result: "GREEN" | "YELLOW" | "RED";
  detail: string;
};
type Respuesta = {
  ok?: boolean;
  green?: number;
  yellow?: number;
  red?: number;
  total?: number;
  plantillas?: Fila[];
  message?: string;
  error?: string;
};

const ETIQUETA: Record<Fila["result"], string> = { GREEN: "Coincide", YELLOW: "Aviso", RED: "Desajuste" };

/** Los parametros que el CRM y Meta declaran, resumidos en una celda. */
function resumen(conteo: Conteo | null) {
  if (!conteo) return "—";
  const partes = [`${conteo.bodyParams} cuerpo`];
  if (conteo.headerParams) partes.push(`${conteo.headerParams} cabecera`);
  if (conteo.buttonParams) partes.push(`${conteo.buttonParams} botón`);
  return partes.join(" · ");
}

/**
 * Auditoria de las plantillas frente a Meta.
 *
 * Meta se edita desde su propio panel, fuera del repositorio. Cuando una
 * plantilla cambia alli, el CRM no se entera hasta que un envio real falla con
 * "la plantilla espera un numero distinto de parametros", y para entonces ya
 * hay un contacto que no recibio su mensaje. Esto permite verlo antes.
 *
 * Solo lee: no hay ninguna accion para editar Meta desde aqui, a proposito.
 * Una plantilla aprobada es un contrato revisado por Meta, y rehacerlo desde un
 * panel interno es como se pierde la revision.
 */
export function WhatsAppTemplateAudit() {
  const [busy, setBusy] = useState(false);
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function auditar() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/whatsapp/templates-audit", { method: "GET" });
      const json = (await res.json()) as Respuesta;
      if (!res.ok || !json.ok) {
        setDatos(null);
        setError(json.error ?? "No se pudo completar la auditoría.");
        return;
      }
      setDatos(json);
    } catch {
      setDatos(null);
      setError("No se pudo completar la auditoría.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>Auditar plantillas con Meta</h2>
      <p className="muted">
        Compara las plantillas que declara el CRM con las registradas en Meta: idioma, estado y número de parámetros.
        Solo lee — no envía ningún mensaje ni modifica nada en Meta.
      </p>
      <div className="form-row">
        <button type="button" className="btn-sm" disabled={busy} onClick={auditar}>
          {busy ? "Consultando Meta…" : "Auditar plantillas con Meta"}
        </button>
      </div>

      {datos?.ok ? (
        <div className="table-wrap">
          <p className="muted">
            <strong>{datos.green} coinciden</strong> · {datos.yellow} con aviso · {datos.red} con desajuste
            {typeof datos.total === "number" ? ` · ${datos.total} plantillas` : null}
          </p>
          <table className="data">
            <thead>
              <tr>
                <th>Plantilla</th>
                <th>Idioma</th>
                <th>Estado Meta</th>
                <th>Parámetros CRM</th>
                <th>Parámetros Meta</th>
                <th>Resultado</th>
                <th>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {(datos.plantillas ?? []).map((fila) => (
                <tr key={fila.key}>
                  <td>{fila.name}</td>
                  <td>{fila.language}</td>
                  <td>{fila.metaStatus ?? "—"}</td>
                  <td>{resumen(fila.codigo)}</td>
                  <td>{resumen(fila.meta)}</td>
                  <td>{ETIQUETA[fila.result]}</td>
                  <td className="muted">{fila.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {error && <p className="result-line is-error" role="status">{error}</p>}
    </section>
  );
}
