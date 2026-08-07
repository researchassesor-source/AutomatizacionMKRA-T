"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Account = {
  accountId: string;
  openId: string | null;
  nickname: string;
  avatarUrl: string | null;
  scopes: string[];
  connectionStatus: string;
  isActive: boolean;
  connectedAt: string | null;
  refreshedAt: string | null;
  accessTokenExpiresAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
};

type Configuration = {
  mode: string;
  clientKeyConfigured: boolean;
  clientSecretConfigured: boolean;
  encryptionKeyConfigured: boolean;
  redirectUri: string | null;
  scopes: string[];
  allowedPrivacyLevels: string[];
  reason: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  READY: "Conectado",
  REAUTH_REQUIRED: "Requiere volver a autorizar",
  DISCONNECTED: "Desconectado",
  EXPIRED: "Autorización caducada",
  ERROR: "Con error",
  UNKNOWN: "Sin comprobar",
  SIMULATION: "Simulación",
  MISSING_PERMISSION: "Permisos insuficientes",
};

/** Mensajes que devuelve el callback en la query string. */
const CALLBACK_MESSAGES: Record<string, string> = {
  conectado: "Cuenta de TikTok conectada correctamente.",
  cancelado: "No se autorizó el acceso: el flujo se canceló en TikTok.",
  estado_invalido: "La autorización no se pudo validar. Vuelve a intentarlo desde el botón.",
  sesion_invalida: "Tu sesión administrativa expiró durante el proceso.",
  sesion_compartida: "Conectar TikTok requiere una cuenta administrativa individual, no el acceso compartido.",
  sin_codigo: "TikTok no devolvió el código de autorización.",
  error_token: "TikTok rechazó el intercambio de credenciales.",
  error_guardado: "No se pudo guardar la conexión.",
  no_configurado: "La integración de TikTok no está configurada.",
  error_proveedor: "TikTok devolvió un error durante la autorización.",
};

export function TikTokPanel() {
  const router = useRouter();
  const [data, setData] = useState<{ configuration: Configuration; accounts: Account[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const response = await fetch("/api/admin/social/tiktok");
    if (!response.ok) return;
    setData(await response.json());
  }

  useEffect(() => {
    load();
    // El callback vuelve con ?tiktok=<estado>: se traduce y se limpia la URL
    // para que recargar no repita el mensaje.
    const params = new URLSearchParams(window.location.search);
    const status = params.get("tiktok");
    if (status) {
      const detail = params.get("detalle");
      setMessage(`${CALLBACK_MESSAGES[status] ?? "Resultado desconocido."}${detail ? ` (${detail})` : ""}`);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  async function connect(reconnect: boolean) {
    if (busy) return;
    setBusy("connect");
    setMessage("Preparando la autorización con TikTok…");
    const response = await fetch("/api/integrations/tiktok/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reconnect }),
    });
    const payload = await response.json().catch(() => ({}));
    setBusy(null);
    if (!response.ok || !payload.authorizeUrl) {
      setMessage(String(payload.error ?? "No se pudo iniciar la conexión con TikTok."));
      return;
    }
    // Navegación de nivel superior: TikTok no admite el flujo dentro de un iframe.
    window.location.href = payload.authorizeUrl;
  }

  async function disconnect(account: Account) {
    if (busy) return;
    if (!window.confirm(`¿Desconectar ${account.nickname}? Se revocará el acceso en TikTok y se borrarán los tokens guardados. El historial de publicaciones se conserva.`)) return;
    setBusy(account.accountId);
    setMessage("Revocando el acceso en TikTok…");
    const response = await fetch("/api/admin/social/tiktok", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: account.accountId, confirm: true }),
    });
    const payload = await response.json().catch(() => ({}));
    setBusy(null);
    setMessage(response.ok ? String(payload.message ?? "Cuenta desconectada.") : String(payload.error ?? "No se pudo desconectar."));
    if (response.ok) {
      await load();
      router.refresh();
    }
  }

  const config = data?.configuration;
  const connected = (data?.accounts ?? []).filter((account) => account.connectionStatus !== "DISCONNECTED");

  return (
    <section className="panel">
      <h2>TikTok</h2>

      {config?.reason ? (
        <p className="muted"><span className="pill warn">No configurado</span> {config.reason}</p>
      ) : (
        <p className="muted">
          <span className="pill info">{config?.mode === "sandbox" ? "Sandbox" : "Producción"}</span>{" "}
          Permisos solicitados: {config?.scopes.join(", ")}. Privacidad permitida: {config?.allowedPrivacyLevels.join(", ")}.
          {config?.mode === "sandbox" && " Una aplicación sin auditar solo puede publicar en privado; por eso el camino principal es enviar el vídeo como borrador."}
        </p>
      )}

      {message && <p className="result-line" role="status">{message}</p>}

      <div className="card-actions">
        <button type="button" className="btn-sm" disabled={busy !== null || Boolean(config?.reason)} onClick={() => connect(false)}>
          {busy === "connect" ? "Conectando…" : "Conectar TikTok"}
        </button>
        {connected.length > 0 && (
          <button type="button" className="btn-sm ghost" disabled={busy !== null} onClick={() => connect(true)}>
            Reconectar
          </button>
        )}
      </div>

      {connected.length === 0 ? (
        <p className="muted">
          Ninguna cuenta de TikTok conectada. Las cuentas de TikTok solo pueden añadirse autorizando desde TikTok:
          no se pueden registrar a mano.
        </p>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Cuenta</th><th>Estado</th><th>Permisos</th><th>Acciones</th></tr>
            </thead>
            <tbody>
              {connected.map((account) => (
                <tr key={account.accountId}>
                  <td>
                    <strong>{account.nickname}</strong>
                    {account.openId && <div className="muted">ID TikTok: {account.openId.slice(0, 10)}…</div>}
                    {account.connectedAt && (
                      <div className="muted">Conectada: {new Date(account.connectedAt).toLocaleString("es-EC", { timeZone: "America/Guayaquil" })}</div>
                    )}
                  </td>
                  <td>
                    <span className={`pill ${account.connectionStatus === "READY" ? "ok" : account.connectionStatus === "REAUTH_REQUIRED" ? "warn" : "err"}`}>
                      {STATUS_LABEL[account.connectionStatus] ?? account.connectionStatus}
                    </span>
                    {account.refreshedAt && (
                      <div className="muted">Token renovado: {new Date(account.refreshedAt).toLocaleString("es-EC", { timeZone: "America/Guayaquil" })}</div>
                    )}
                    {account.lastErrorMessage && <div className="muted">{account.lastErrorMessage}</div>}
                  </td>
                  <td>{account.scopes.length ? account.scopes.join(", ") : <span className="muted">Sin registrar</span>}</td>
                  <td>
                    <button type="button" className="btn-sm danger" disabled={busy !== null} onClick={() => disconnect(account)}>
                      {busy === account.accountId ? "Desconectando…" : "Desconectar"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
