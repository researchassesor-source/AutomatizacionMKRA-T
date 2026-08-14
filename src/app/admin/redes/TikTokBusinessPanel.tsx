"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Connection = {
  accountId: string;
  businessId: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  scopes: string[];
  status: string;
  connectedAt: string | null;
  refreshedAt: string | null;
  lastErrorMessage: string | null;
};

type Configuration = {
  mode: string;
  scopes: string[];
  liveFrom: string | null;
  connectionReason: string | null;
  reason: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  READY: "Conectado",
  REAUTH_REQUIRED: "Requiere reautorización",
  MISSING_PERMISSION: "Permisos insuficientes",
  DISCONNECTED: "Desconectado",
  ERROR: "Error",
  UNKNOWN: "Pendiente de configuración",
};

const CALLBACK_MESSAGE: Record<string, string> = {
  conectado: "Cuenta TikTok Business conectada.",
  permisos_insuficientes: "La cuenta se conectó, pero faltan permisos requeridos.",
  cancelado: "La autorización fue cancelada.",
  estado_invalido: "La autorización caducó o no pudo validarse. Intenta de nuevo.",
  sesion_invalida: "La sesión administrativa expiró durante la autorización.",
  sin_codigo: "TikTok no devolvió un código de autorización.",
  error_token: "TikTok rechazó el intercambio de autorización.",
  error_cuenta: "No se pudo verificar la cuenta autorizada.",
  error_guardado: "No se pudo guardar la conexión.",
  no_configurado: "La aplicación TikTok Business está pendiente de aprobación/configuración.",
  error_proveedor: "TikTok devolvió un error durante la autorización.",
  advertiser_no_implementado: "El callback publicitario está disponible; este CRM no implementa Ads.",
};

export function TikTokBusinessPanel() {
  const router = useRouter();
  const [data, setData] = useState<{ configuration: Configuration; accounts: Connection[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/social/tiktok-business", { cache: "no-store" });
    if (response.ok) setData(await response.json());
  }, []);

  useEffect(() => {
    load();
    const params = new URLSearchParams(window.location.search);
    const status = params.get("tiktokBusiness");
    if (status) {
      setMessage(CALLBACK_MESSAGE[status] ?? "TikTok Business devolvió un resultado no reconocido.");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [load]);

  async function connect(reconnect: boolean) {
    if (busy) return;
    setBusy("connect");
    const response = await fetch("/api/integrations/tiktok-business/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reconnect }),
    });
    const payload = await response.json().catch(() => ({}));
    setBusy(null);
    if (!response.ok || !payload.authorizeUrl) {
      setMessage(String(payload.error ?? "No se pudo iniciar la autorización."));
      return;
    }
    window.location.href = payload.authorizeUrl;
  }

  async function disconnect(connection: Connection) {
    if (busy || !window.confirm(`¿Desconectar ${connection.displayName ?? connection.username ?? "esta cuenta"}? El historial se conservará.`)) return;
    setBusy(connection.accountId);
    const response = await fetch("/api/admin/social/tiktok-business", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: connection.accountId, confirm: true }),
    });
    const payload = await response.json().catch(() => ({}));
    setBusy(null);
    setMessage(String(response.ok ? payload.message : payload.error ?? "No se pudo desconectar."));
    if (response.ok) {
      await load();
      router.refresh();
    }
  }

  const configuration = data?.configuration;
  const connected = (data?.accounts ?? []).filter((account) => account.status !== "DISCONNECTED");

  return (
    <section className="panel">
      <h2>TikTok Business</h2>
      {configuration?.connectionReason ? (
        <p className="muted"><span className="pill warn">Pendiente de configuración</span> {configuration.connectionReason}</p>
      ) : configuration?.reason ? (
        <p className="muted"><span className="pill warn">Publicación bloqueada</span> {configuration.reason} La cuenta sí puede conectarse de forma controlada.</p>
      ) : (
        <p className="muted"><span className="pill ok">Configurado</span> Permisos: {configuration?.scopes.join(", ")}. Activación: {configuration?.liveFrom ? new Date(configuration.liveFrom).toLocaleString("es-EC", { timeZone: "America/Guayaquil" }) : "bloqueada"}.</p>
      )}
      {message && <p className="result-line" role="status">{message}</p>}
      <div className="card-actions">
        <button type="button" className="btn-sm" disabled={Boolean(configuration?.connectionReason) || busy !== null} onClick={() => connect(false)}>
          {busy === "connect" ? "Conectando…" : "Conectar"}
        </button>
        {connected.length > 0 && <button type="button" className="btn-sm ghost" disabled={busy !== null} onClick={() => connect(true)}>Reconectar</button>}
      </div>
      {connected.length === 0 ? <p className="muted">No hay una cuenta TikTok Business conectada.</p> : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Cuenta</th><th>Estado</th><th>Permisos</th><th>Acciones</th></tr></thead>
            <tbody>{connected.map((connection) => (
              <tr key={connection.accountId}>
                <td>
                  {connection.avatarUrl && (
                    // biome-ignore lint/performance/noImgElement: el host de avatar es dinámico y no contiene secretos.
                    <img src={connection.avatarUrl} alt="" width={36} height={36} style={{ borderRadius: "50%", verticalAlign: "middle", marginRight: 8 }} />
                  )}
                  <strong>{connection.displayName ?? connection.username ?? "Cuenta TikTok"}</strong>
                  <div className="muted">ID: {connection.businessId.slice(0, 8)}…</div>
                  {connection.connectedAt && <div className="muted">Conectada: {new Date(connection.connectedAt).toLocaleString("es-EC", { timeZone: "America/Guayaquil" })}</div>}
                </td>
                <td><span className={`pill ${connection.status === "READY" ? "ok" : connection.status === "REAUTH_REQUIRED" ? "warn" : "err"}`}>{STATUS_LABEL[connection.status] ?? connection.status}</span>{connection.lastErrorMessage && <div className="muted">{connection.lastErrorMessage}</div>}</td>
                <td>{connection.scopes.join(", ") || "Sin permisos registrados"}</td>
                <td><button type="button" className="btn-sm danger" disabled={busy !== null} onClick={() => disconnect(connection)}>{busy === connection.accountId ? "Desconectando…" : "Desconectar"}</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
