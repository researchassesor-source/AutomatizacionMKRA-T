"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ecuadorLocalDateTimeToIso, isoToEcuadorLocalInput } from "@/lib/time";
import { AdminEmptyState } from "../AdminEmptyState";
import { presentAdminValue } from "../adminPresentation";

type Account = { id: string; platform: string; displayName: string; externalId: string | null; isActive: boolean; connectorState: "SIMULATION" | "READY" | "NOT_CONFIGURED" | "UNSUPPORTED"; connectionStatus: string; connectionCheckedAt: string | null; connectionError: string | null };
type Post = { id: string; caption: string; mediaUrl: string | null; linkUrl: string | null; status: string; account: string; scheduledAt: string | null; error: string | null; errorCode: string | null; providerPostUrl: string | null; externalPostId: string | null };
type Schedule = { id: string; name: string; caption: string; mediaUrl: string | null; linkUrl: string | null; weekday: number; localTime: string; isActive: boolean; nextRunAt: string; account: string };
const platforms = [{ value: "INSTAGRAM", label: "Instagram" }, { value: "FACEBOOK", label: "Facebook" }, { value: "TIKTOK", label: "TikTok" }];
const weekdays = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

async function request(url: string, method: string, body?: unknown) {
  const response = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  return { ok: response.ok, data: await response.json().catch(() => ({})) };
}

export function RedesManager({ accounts, posts, schedules }: { accounts: Account[]; posts: Post[]; schedules: Schedule[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [mediaUrl, setMediaUrl] = useState("");
  const usableAccounts = accounts.filter((account) => account.isActive && ["SIMULATION", "READY"].includes(account.connectorState));

  async function run(id: string, action: () => Promise<{ ok: boolean; data: Record<string, unknown> }>, success: string) {
    setBusy(id); const result = await action(); setBusy(null);
    setMessage(result.ok ? success : String(result.data.error ?? "No se pudo completar la acción."));
    if (result.ok) router.refresh();
    return result;
  }

  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return; setBusy("upload");
    try {
      if (file.type.startsWith("video/")) {
        const { upload: uploadBlob } = await import("@vercel/blob/client");
        const blob = await uploadBlob(`social/${Date.now()}-${file.name}`, file, { access: "public", handleUploadUrl: "/api/admin/upload/token" });
        setMediaUrl(blob.url);
      } else {
        const form = new FormData(); form.append("file", file);
        const response = await fetch("/api/admin/upload", { method: "POST", body: form });
        const result = await response.json(); if (!response.ok) throw new Error(result.error); setMediaUrl(result.url);
      }
      setMessage("Archivo preparado.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo preparar el archivo."); }
    setBusy(null);
  }

  async function registerAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    const result = await run("account-new", () => request("/api/admin/social/accounts", "POST", { platform: data.get("platform"), displayName: data.get("displayName"), externalId: data.get("externalId") || undefined }), "Cuenta guardada en modo seguro.");
    if (result.ok) form.reset();
  }

  async function editAccount(event: React.FormEvent<HTMLFormElement>, account: Account) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    await run(account.id, () => request(`/api/admin/social/accounts/${account.id}`, "PATCH", { displayName: data.get("displayName"), externalId: data.get("externalId") || null }), "Cuenta actualizada.");
  }

  async function accountToggle(account: Account) {
    if (!window.confirm(`¿${account.isActive ? "Desactivar" : "Activar"} ${account.displayName}? No se eliminará historial.`)) return;
    await run(account.id, () => request(`/api/admin/social/accounts/${account.id}`, "PATCH", { isActive: !account.isActive, confirm: true }), "Cuenta actualizada.");
  }

  async function verify(account: Account) {
    await run(account.id, () => request("/api/admin/social/test", "POST", { platform: account.platform }), account.connectorState === "SIMULATION" ? "Comprobación simulada: Preview no consultó al proveedor." : "Conexión comprobada.");
  }

  /** Registra la página de Facebook y la cuenta de Instagram configuradas en Vercel. */
  async function syncMetaAccounts() {
    if (!window.confirm("¿Registrar en el CRM la página de Facebook y la cuenta de Instagram configuradas, y comprobar su estado? No se publica contenido.")) return;
    await run("meta-sync", () => request("/api/admin/social/accounts/sync-meta", "POST", { confirm: true }), "Cuentas de Meta sincronizadas y comprobadas.");
  }

  async function createPost(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const localDate = String(data.get("scheduledAt") || "");
    const result = await run("post-new", () => request("/api/admin/social/posts", "POST", { accountId: data.get("accountId"), caption: data.get("caption"), mediaUrl: mediaUrl || data.get("mediaUrl") || "", linkUrl: data.get("linkUrl") || "", scheduledAt: localDate ? ecuadorLocalDateTimeToIso(localDate) : "" }), "Publicación creada sin contactar al proveedor.");
    if (result.ok) { form.reset(); setMediaUrl(""); }
  }

  async function editPost(event: React.FormEvent<HTMLFormElement>, post: Post) {
    event.preventDefault(); const data = new FormData(event.currentTarget); const localDate = String(data.get("scheduledAt") || "");
    await run(post.id, () => request(`/api/admin/social/posts/${post.id}`, "PATCH", { action: "update", caption: data.get("caption"), mediaUrl: data.get("mediaUrl") || null, linkUrl: data.get("linkUrl") || null, scheduledAt: localDate ? ecuadorLocalDateTimeToIso(localDate) : null }), "Borrador actualizado.");
  }

  async function postAction(post: Post, action: "publish" | "duplicate" | "cancel" | "retry" | "archive" | "delete") {
    const descriptions = { publish: "procesar esta publicación ahora", duplicate: "duplicar esta publicación como borrador", cancel: "cancelar esta programación", retry: "reintentar esta publicación", archive: "archivar localmente este registro sin borrar contenido del proveedor", delete: "eliminar definitivamente este borrador o simulación local" };
    if (!window.confirm(`¿Confirmas ${descriptions[action]}?${action === "publish" ? " En Preview solo se simulará." : ""}`)) return;
    const operation = action === "publish"
      ? () => request("/api/admin/social/publish", "POST", { postId: post.id, confirm: true })
      : action === "delete"
        ? () => request(`/api/admin/social/posts/${post.id}`, "DELETE", { confirm: "DELETE_LOCAL_DRAFT" })
        : () => request(`/api/admin/social/posts/${post.id}`, "PATCH", { action, confirm: true });
    await run(post.id, operation, action === "delete" ? "Registro local eliminado; no se solicitó eliminación externa." : action === "archive" ? "Registro archivado localmente; el proveedor no fue modificado." : action === "publish" ? "Publicación procesada en SIMULATED; no se llamó al proveedor." : "Publicación actualizada.");
  }

  async function createSchedule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    const result = await run("schedule-new", () => request("/api/admin/social/schedules", "POST", { accountId: data.get("accountId"), name: data.get("name"), caption: data.get("caption"), mediaUrl: data.get("mediaUrl") || "", linkUrl: data.get("linkUrl") || "", weekday: Number(data.get("weekday")), localTime: data.get("localTime") }), "Recurrencia semanal creada.");
    if (result.ok) form.reset();
  }

  async function editSchedule(event: React.FormEvent<HTMLFormElement>, schedule: Schedule) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    await run(schedule.id, () => request(`/api/admin/social/schedules/${schedule.id}`, "PATCH", { action: "update", confirm: true, name: data.get("name"), weekday: Number(data.get("weekday")), localTime: data.get("localTime"), caption: data.get("caption"), mediaUrl: data.get("mediaUrl") || "", linkUrl: data.get("linkUrl") || "" }), "Recurrencia actualizada.");
  }

  async function scheduleStatus(schedule: Schedule, action: "pause" | "resume" | "archive") {
    if (!window.confirm(action === "archive" ? "¿Archivar la recurrencia conservando su historial?" : `¿${action === "pause" ? "Pausar" : "Reactivar"} esta recurrencia?`)) return;
    await run(schedule.id, () => request(`/api/admin/social/schedules/${schedule.id}`, "PATCH", { action, confirm: true }), "Recurrencia actualizada.");
  }

  const accountState = (account: Account) => !account.isActive ? "Inactiva" : account.connectorState === "SIMULATION" ? "SIMULATED" : account.connectionStatus === "READY" ? "Conexión validada" : presentAdminValue(account.connectionStatus);

  return <>
    {message && <div className="panel result-line" role="status">{message}</div>}
    <section className="panel"><h2>Cuentas sociales</h2><p className="muted">Las cuentas no almacenan credenciales desde este formulario. Preview fuerza SIMULATED y nunca publica contenido real.</p>
      <p><button type="button" className="btn-sm" disabled={busy === "meta-sync"} onClick={syncMetaAccounts}>Sincronizar cuentas de Meta</button> <span className="muted">Toma la página de Facebook y la cuenta de Instagram de la configuración del servidor y comprueba su estado.</span></p>
      <form onSubmit={registerAccount}><div className="form-row"><select name="platform" aria-label="Red social">{platforms.map((platform) => <option key={platform.value} value={platform.value}>{platform.label}</option>)}</select><input name="displayName" aria-label="Nombre visible de la cuenta" placeholder="Nombre visible" required /><input name="externalId" aria-label="Identificador externo" placeholder="ID externo (opcional)" /><button type="submit" className="btn-sm" disabled={busy === "account-new"}>Guardar cuenta</button></div></form>
      {accounts.length ? <div className="table-wrap"><table className="data"><thead><tr><th>Red/cuenta</th><th>Estado verificable</th><th>Acciones</th></tr></thead><tbody>{accounts.map((account) => <tr key={account.id}><td><strong>{presentAdminValue(account.platform)} · {account.displayName}</strong><div className="muted">{account.externalId || "Sin ID externo"}</div><details><summary>Editar datos locales</summary><form onSubmit={(event) => editAccount(event, account)}><input name="displayName" defaultValue={account.displayName} required /><input name="externalId" defaultValue={account.externalId ?? ""} placeholder="ID externo" /><button type="submit" className="btn-sm" disabled={busy === account.id}>Guardar</button></form></details></td><td><span className={`pill ${account.connectionStatus === "READY" ? "ok" : account.connectionStatus === "ERROR" ? "err" : "info"}`}>{accountState(account)}</span>{account.connectionCheckedAt && <div className="muted">Comprobada: {new Date(account.connectionCheckedAt).toLocaleString("es-EC", { timeZone: "America/Guayaquil" })}</div>}{account.connectionError && <div className="muted">{account.connectionError}</div>}</td><td><div className="card-actions"><button type="button" className="btn-sm ghost" disabled={busy === account.id} onClick={() => verify(account)}>Comprobar estado</button><button type="button" className="btn-sm ghost" disabled={busy === account.id} onClick={() => accountToggle(account)}>{account.isActive ? "Desactivar" : "Activar"}</button></div></td></tr>)}</tbody></table></div> : <AdminEmptyState icon="social" title="Sin cuentas" description="Registra una cuenta para organizar contenido en simulación." />}
    </section>

    <section className="panel"><h2>Nueva publicación</h2>{usableAccounts.length === 0 ? <p className="muted">No hay cuentas disponibles.</p> : <form onSubmit={createPost}><div className="form-row"><select name="accountId">{usableAccounts.map((account) => <option value={account.id} key={account.id}>{account.platform} · {account.displayName}</option>)}</select><input name="linkUrl" type="url" placeholder="Enlace (opcional)" /><input name="scheduledAt" type="datetime-local" aria-label="Fecha Ecuador" /></div><div className="form-row"><label className="btn-sm ghost">{busy === "upload" ? "Preparando…" : "Subir imagen o video"}<input type="file" accept="image/*,video/*" hidden onChange={upload} /></label><input name="mediaUrl" type="url" value={mediaUrl} onChange={(event) => setMediaUrl(event.target.value)} placeholder="URL multimedia" /></div><textarea name="caption" rows={4} placeholder="Texto de la publicación" required /><button type="submit" className="btn-sm" disabled={busy === "post-new"}>Crear publicación</button></form>}</section>

    <section className="panel"><h2>Publicaciones</h2>{posts.length === 0 ? <AdminEmptyState icon="social" title="No hay publicaciones" description="Crea el primer borrador." /> : <div className="table-wrap"><table className="data"><thead><tr><th>Cuenta/contenido</th><th>Estado verificable</th><th>Programación</th><th>Acciones</th></tr></thead><tbody>{posts.map((post) => <tr key={post.id}><td><strong>{post.account}</strong><p>{post.caption.slice(0, 180)}{post.caption.length > 180 ? "…" : ""}</p>{["BORRADOR","PROGRAMADO","FALLIDO","SIMULADO"].includes(post.status) && <details><summary>Editar borrador</summary><form onSubmit={(event) => editPost(event, post)}><textarea name="caption" rows={4} defaultValue={post.caption} required /><input name="mediaUrl" type="url" defaultValue={post.mediaUrl ?? ""} placeholder="URL multimedia" /><input name="linkUrl" type="url" defaultValue={post.linkUrl ?? ""} placeholder="Enlace" /><input name="scheduledAt" type="datetime-local" defaultValue={post.scheduledAt ? isoToEcuadorLocalInput(post.scheduledAt) : ""} /><button type="submit" className="btn-sm" disabled={busy === post.id}>Guardar borrador</button></form></details>}</td><td><span className={`pill ${post.status === "PUBLICADO" ? "ok" : ["FALLIDO"].includes(post.status) ? "err" : post.status === "PROGRAMADO" ? "warn" : "info"}`}>{presentAdminValue(post.status)}</span>{post.externalPostId && <div className="muted">ID proveedor: {post.externalPostId}</div>}{post.providerPostUrl && <a href={post.providerPostUrl} target="_blank" rel="noreferrer">Ver en proveedor ↗</a>}{(post.error || post.errorCode) && <div className="muted">{post.errorCode ? `${post.errorCode}: ` : ""}{post.error}</div>}</td><td>{post.scheduledAt ? new Date(post.scheduledAt).toLocaleString("es-EC", { timeZone: "America/Guayaquil" }) : "Borrador"}</td><td><div className="card-actions">{["BORRADOR","PROGRAMADO","FALLIDO","SIMULADO"].includes(post.status) && <><button className="btn-sm" type="button" disabled={busy === post.id} onClick={() => postAction(post, post.status === "FALLIDO" ? "retry" : "publish")}>{post.status === "FALLIDO" ? "Reintentar" : "Procesar"}</button><button className="btn-sm ghost" type="button" disabled={busy === post.id} onClick={() => postAction(post, "duplicate")}>Duplicar</button><button className="btn-sm ghost" type="button" disabled={busy === post.id} onClick={() => postAction(post, "cancel")}>Cancelar</button></>}<button className="btn-sm ghost" type="button" disabled={busy === post.id} onClick={() => postAction(post, "archive")}>Archivar local</button>{["BORRADOR","SIMULADO","FALLIDO","CANCELADO","ARCHIVADO"].includes(post.status) && !post.externalPostId && <button className="btn-sm danger" type="button" disabled={busy === post.id} onClick={() => postAction(post, "delete")}>Eliminar local</button>}</div></td></tr>)}</tbody></table></div>}</section>

    <section className="panel"><h2>Recurrencia semanal</h2><p className="muted">Zona horaria fija: America/Guayaquil. Cada ocurrencia utiliza una clave idempotente.</p>{usableAccounts.length > 0 && <form onSubmit={createSchedule}><div className="form-row"><select name="accountId">{usableAccounts.map((account) => <option key={account.id} value={account.id}>{account.platform} · {account.displayName}</option>)}</select><input name="name" placeholder="Nombre" required /><select name="weekday">{weekdays.map((day, index) => <option value={index} key={day}>{day}</option>)}</select><input name="localTime" type="time" required /></div><textarea name="caption" rows={3} placeholder="Contenido recurrente" required /><div className="form-row"><input name="mediaUrl" type="url" placeholder="URL multimedia" /><input name="linkUrl" type="url" placeholder="Enlace" /><button type="submit" className="btn-sm" disabled={busy === "schedule-new"}>Crear recurrencia</button></div></form>}{schedules.length ? <div className="table-wrap"><table className="data"><thead><tr><th>Recurrencia</th><th>Próxima ejecución</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{schedules.map((schedule) => <tr key={schedule.id}><td><strong>{schedule.name}</strong><div className="muted">{schedule.account} · {weekdays[schedule.weekday]} {schedule.localTime}</div><details><summary>Editar recurrencia</summary><form onSubmit={(event) => editSchedule(event, schedule)}><input name="name" defaultValue={schedule.name} required /><select name="weekday" defaultValue={schedule.weekday}>{weekdays.map((day, index) => <option value={index} key={day}>{day}</option>)}</select><input name="localTime" type="time" defaultValue={schedule.localTime} required /><textarea name="caption" rows={3} defaultValue={schedule.caption} required /><input name="mediaUrl" type="url" defaultValue={schedule.mediaUrl ?? ""} /><input name="linkUrl" type="url" defaultValue={schedule.linkUrl ?? ""} /><button type="submit" className="btn-sm" disabled={busy === schedule.id}>Guardar</button></form></details></td><td>{new Date(schedule.nextRunAt).toLocaleString("es-EC", { timeZone: "America/Guayaquil" })}</td><td><span className={`pill ${schedule.isActive ? "ok" : "info"}`}>{schedule.isActive ? "Activa" : "Inactiva"}</span></td><td><div className="card-actions"><button className="btn-sm ghost" type="button" disabled={busy === schedule.id} onClick={() => scheduleStatus(schedule, schedule.isActive ? "pause" : "resume")}>{schedule.isActive ? "Pausar" : "Reactivar"}</button><button className="btn-sm danger" type="button" disabled={busy === schedule.id} onClick={() => scheduleStatus(schedule, "archive")}>Archivar</button></div></td></tr>)}</tbody></table></div> : null}</section>
  </>;
}
