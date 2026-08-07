"use client";

import { useCallback, useEffect, useState } from "react";
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
  // Estado del formulario de subida como borrador.
  const [mediaUrl, setMediaUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [consent, setConsent] = useState(false);
  const [uploadState, setUploadState] = useState<{ publishId: string; status: string; description: string } | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/social/tiktok");
    if (!response.ok) return;
    setData(await response.json());
  }, []);

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
  }, [load]);

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

  /** Sube el archivo al almacenamiento del CRM antes de enviarlo a TikTok. */
  async function pickVideo(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      setMessage("TikTok solo admite vídeo. Elige un archivo MP4 o MOV.");
      return;
    }
    setBusy("upload-file");
    setMessage("Subiendo el vídeo al almacenamiento del CRM…");
    try {
      const { upload } = await import("@vercel/blob/client");
      const blob = await upload(`tiktok/${Date.now()}-${file.name}`, file, {
        access: "public",
        handleUploadUrl: "/api/admin/upload/token",
      });
      setMediaUrl(blob.url);
      setMessage("Vídeo preparado. Revisa el texto y confirma para enviarlo a TikTok.");
    } catch {
      setMessage("No se pudo subir el vídeo al almacenamiento.");
    }
    setBusy(null);
  }

  /**
   * Envía el vídeo a la bandeja de TikTok como borrador. No publica: la
   * persona termina desde la aplicación de TikTok.
   */
  async function sendDraft(account: Account) {
    if (busy) return;
    if (!mediaUrl) { setMessage("Primero elige un vídeo."); return; }
    if (!consent) { setMessage("Debes aceptar la Confirmación de uso de música de TikTok."); return; }
    setBusy("draft");
    setMessage("Creando la publicación…");
    // 1) Se registra la publicación en el CRM para tener trazabilidad.
    const created = await fetch("/api/admin/social/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: account.accountId, caption: caption || "Vídeo de R.A. Training", mediaUrl, linkUrl: "", scheduledAt: "" }),
    });
    const createdPayload = await created.json().catch(() => ({}));
    if (!created.ok || !createdPayload.postId) {
      setBusy(null);
      setMessage(String(createdPayload.error ?? "No se pudo registrar la publicación."));
      return;
    }

    // 2) Se envía a TikTok.
    setMessage("Enviando el vídeo a TikTok…");
    const sent = await fetch("/api/admin/social/tiktok/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId: createdPayload.postId, accountId: account.accountId, consentAccepted: true }),
    });
    const sentPayload = await sent.json().catch(() => ({}));
    setBusy(null);
    if (!sent.ok) {
      setMessage(String(sentPayload.error ?? "TikTok rechazó el envío."));
      return;
    }
    setUploadState({ publishId: sentPayload.publishId, status: sentPayload.status, description: sentPayload.message });
    setMessage(sentPayload.message);
    setMediaUrl("");
    setCaption("");
    setConsent(false);
    // 3) Se consulta el estado real: un HTTP 200 no significa que esté listo.
    pollStatus(createdPayload.postId, account.accountId);
    router.refresh();
  }

  async function pollStatus(postId: string, accountId: string, attempt = 0) {
    if (attempt > 8) return;
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const response = await fetch(`/api/admin/social/tiktok/upload?postId=${postId}&accountId=${accountId}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return;
    setUploadState({ publishId: payload.publishId, status: payload.status, description: payload.description });
    if (!payload.terminal && payload.status !== "SEND_TO_USER_INBOX") pollStatus(postId, accountId, attempt + 1);
  }

  const config = data?.configuration;
  const connected = (data?.accounts ?? []).filter((account) => account.connectionStatus !== "DISCONNECTED");
  const active = connected.find((account) => account.connectionStatus === "READY");

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

      {active && (
        <div className="stacked-forms" style={{ marginTop: 18 }}>
          <h3>Enviar un vídeo a TikTok como borrador</h3>
          <p className="muted">
            El vídeo llega a la bandeja de <strong>{active.nickname}</strong> en TikTok. No se publica solo:
            hay que abrirlo desde la notificación de TikTok, revisarlo y publicarlo desde la aplicación.
          </p>

          <label className="field">
            <span>1. Vídeo (MP4 o MOV)</span>
            <input type="file" accept="video/mp4,video/quicktime" disabled={busy !== null} onChange={pickVideo} />
          </label>
          {mediaUrl && (
            <>
              <p className="muted">Vista previa:</p>
              {/* biome-ignore lint/a11y/useMediaCaption: vídeo de trabajo sin pista de subtítulos. */}
              <video src={mediaUrl} controls style={{ maxWidth: 260, borderRadius: 8, display: "block" }} />
            </>
          )}

          <label className="field">
            <span>2. Texto del vídeo</span>
            <textarea
              rows={3}
              value={caption}
              maxLength={2200}
              onChange={(event) => setCaption(event.target.value)}
              placeholder="Puedes editarlo también en TikTok antes de publicar."
            />
          </label>

          {/* El consentimiento no viene marcado: debe ser un acto explícito. */}
          <label className="checkbox">
            <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
            <span>
              3. Confirmo que este contenido cumple la <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/es" target="_blank" rel="noreferrer">Confirmación de uso de música</a> de TikTok.
            </span>
          </label>

          <button
            type="button"
            className="btn-sm"
            disabled={busy !== null || !mediaUrl || !consent}
            onClick={() => sendDraft(active)}
          >
            {busy === "draft" ? "Enviando a TikTok…" : busy === "upload-file" ? "Subiendo vídeo…" : "Enviar como borrador a TikTok"}
          </button>

          {uploadState && (
            <p className="result-line" role="status">
              <strong>Estado en TikTok:</strong> {uploadState.description}
              <br />
              <span className="muted">Identificador de envío: {uploadState.publishId}</span>
            </p>
          )}

          <p className="muted">
            La publicación automática (sin pasar por la app) requiere que TikTok apruebe la aplicación.
            Mientras tanto, este es el flujo disponible.
          </p>
        </div>
      )}
    </section>
  );
}
