"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AdminEmptyState } from "../AdminEmptyState";
import { presentAdminValue } from "../adminPresentation";
import { ecuadorLocalDateTimeToIso, isoToEcuadorLocalInput } from "@/lib/time";

type Account = { id: string; platform: string; displayName: string; isActive: boolean; connectorState: "SIMULATION" | "READY" | "NOT_CONFIGURED" | "UNSUPPORTED" };
type Post = { id: string; caption: string; mediaUrl: string | null; linkUrl: string | null; status: string; account: string; scheduledAt: string | null; error: string | null };
type Schedule = { id: string; name: string; caption: string; mediaUrl: string | null; linkUrl: string | null; weekday: number; localTime: string; isActive: boolean; nextRunAt: string; account: string };
const platforms = [
  { value: "INSTAGRAM", label: "Instagram" },
  { value: "FACEBOOK", label: "Facebook" },
  { value: "TIKTOK", label: "TikTok" },
  { value: "YOUTUBE", label: "YouTube (sin conector)", disabled: true },
  { value: "LINKEDIN", label: "LinkedIn (sin conector)", disabled: true },
];
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

  function accountStatus(account: Account) {
    if (account.connectorState === "UNSUPPORTED") return "Sin conector";
    if (account.connectorState === "NOT_CONFIGURED") return "No configurada";
    if (!account.isActive) return "Inactiva";
    return account.connectorState === "SIMULATION" ? "Simulación" : "Activa";
  }

  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy("upload");
    try {
      if (file.type.startsWith("video/")) {
        const { upload } = await import("@vercel/blob/client");
        const blob = await upload(`social/${Date.now()}-${file.name}`, file, { access: "public", handleUploadUrl: "/api/admin/upload/token" });
        setMediaUrl(blob.url);
      } else {
        const form = new FormData(); form.append("file", file);
        const response = await fetch("/api/admin/upload", { method: "POST", body: form });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        setMediaUrl(result.url);
      }
      setMessage("Archivo preparado.");
    } catch (error) { setMessage((error as Error).message ?? "No se pudo preparar el archivo."); }
    setBusy(null);
  }

  async function registerAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); setBusy("account");
    const result = await request("/api/admin/social/accounts", "POST", { platform: data.get("platform"), displayName: data.get("displayName"), externalId: data.get("externalId") || undefined });
    setMessage(result.ok ? "Cuenta guardada." : result.data.error); setBusy(null); if (result.ok) { form.reset(); router.refresh(); }
  }

  async function accountAction(account: Account, action: "toggle" | "edit" | "delete") {
    if (action === "delete" && !window.confirm(`¿Eliminar o desactivar “${account.displayName}”?`)) return;
    const displayName = action === "edit" ? window.prompt("Nombre visible", account.displayName) : undefined;
    if (action === "edit" && !displayName) return;
    setBusy(account.id);
    const result = action === "delete"
      ? await request(`/api/admin/social/accounts/${account.id}`, "DELETE", { confirm: true })
      : await request(`/api/admin/social/accounts/${account.id}`, "PATCH", action === "toggle" ? { isActive: !account.isActive, confirm: true } : { displayName });
    setMessage(result.ok ? "Cuenta actualizada." : result.data.error); setBusy(null); router.refresh();
  }

  async function createPost(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); setBusy("post");
    const date = String(data.get("scheduledAt") || "");
    const result = await request("/api/admin/social/posts", "POST", { accountId: data.get("accountId"), caption: data.get("caption"), mediaUrl: mediaUrl || data.get("mediaUrl") || "", linkUrl: data.get("linkUrl") || "", scheduledAt: date ? ecuadorLocalDateTimeToIso(date) : "" });
    setMessage(result.ok ? "Publicación creada." : result.data.error); setBusy(null); if (result.ok) { form.reset(); setMediaUrl(""); router.refresh(); }
  }

  async function postAction(post: Post, action: string) {
    let body: Record<string, unknown> = { action };
    if (action === "update") {
      const caption = window.prompt("Texto de la publicación", post.caption);
      if (!caption) return;
      body = { action, caption, mediaUrl: post.mediaUrl, linkUrl: post.linkUrl };
    }
    if (action === "reschedule") {
      const date = window.prompt("Nueva fecha y hora en Ecuador (AAAA-MM-DDTHH:mm)", post.scheduledAt ? isoToEcuadorLocalInput(post.scheduledAt) : "");
      if (!date) return;
      body = { action, scheduledAt: ecuadorLocalDateTimeToIso(date) };
    }
    if (action === "cancel" && !window.confirm("¿Cancelar esta publicación?")) return;
    if (action === "cancel") body.confirm = true;
    if (action === "publish" && !window.confirm("¿Publicar esta entrada ahora? Esta acción puede comunicarse con una red externa.")) return;
    if (action === "retry" && !window.confirm("¿Reintentar ahora esta publicación?")) return;
    if (action === "retry") body.confirm = true;
    setBusy(post.id);
    const result = action === "publish" ? await request("/api/admin/social/publish", "POST", { postId: post.id, confirm: true }) : await request(`/api/admin/social/posts/${post.id}`, "PATCH", body);
    setMessage(result.ok ? (result.data.simulated ? "Publicación simulada de forma segura." : "Publicación actualizada.") : result.data.error); setBusy(null); router.refresh();
  }

  async function createSchedule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); setBusy("schedule");
    const result = await request("/api/admin/social/schedules", "POST", { accountId: data.get("accountId"), name: data.get("name"), caption: data.get("caption"), mediaUrl: data.get("mediaUrl") || "", linkUrl: data.get("linkUrl") || "", weekday: Number(data.get("weekday")), localTime: data.get("localTime") });
    setMessage(result.ok ? "Recurrencia semanal creada." : result.data.error); setBusy(null); if (result.ok) { form.reset(); router.refresh(); }
  }

  async function scheduleAction(schedule: Schedule, action: "update" | "pause" | "resume" | "archive") {
    let body: Record<string, unknown> = { action, confirm: true };
    if (action === "update") {
      const name = window.prompt("Nombre de la recurrencia", schedule.name)?.trim();
      if (!name) return;
      const weekday = Number(window.prompt("Día de la semana (0 domingo a 6 sábado)", String(schedule.weekday)));
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) { setMessage("El día debe estar entre 0 y 6."); return; }
      const localTime = window.prompt("Hora en America/Guayaquil (HH:mm)", schedule.localTime)?.trim();
      if (!localTime || !/^([01]\d|2[0-3]):[0-5]\d$/.test(localTime)) { setMessage("La hora no es válida."); return; }
      const caption = window.prompt("Contenido recurrente", schedule.caption)?.trim();
      if (!caption) return;
      body = { ...body, name, weekday, localTime, caption, mediaUrl: schedule.mediaUrl ?? "", linkUrl: schedule.linkUrl ?? "" };
    }
    const question = action === "pause" ? "¿Pausar esta recurrencia?" : action === "resume" ? "¿Reactivar esta recurrencia y recalcular su próxima ejecución?" : action === "archive" ? "¿Archivar esta recurrencia? Se conservará su historial." : "¿Guardar los cambios de esta recurrencia?";
    if (!window.confirm(question)) return;
    setBusy(schedule.id);
    const result = await request(`/api/admin/social/schedules/${schedule.id}`, "PATCH", body);
    setMessage(result.ok ? "Recurrencia actualizada." : result.data.error);
    setBusy(null);
    if (result.ok) router.refresh();
  }

  return <>
    {message && <div className="panel result-line" role="status">{message}</div>}
    <section className="panel"><h2>Cuentas sociales</h2><p className="muted">YouTube y LinkedIn se muestran como integraciones no disponibles; no pueden activarse ni publicar.</p><form onSubmit={registerAccount}><div className="form-row"><select name="platform" aria-label="Red social">{platforms.map((platform) => <option key={platform.value} value={platform.value} disabled={platform.disabled}>{platform.label}</option>)}</select><input name="displayName" aria-label="Nombre visible de la cuenta" placeholder="Nombre visible" required /><input name="externalId" aria-label="Identificador externo de la cuenta" placeholder="Identificador externo (opcional)" /><button type="submit" className="btn-sm" disabled={busy === "account"}>Guardar cuenta</button></div></form>{accounts.length > 0 ? <div className="table-wrap"><table className="data"><thead><tr><th>Red</th><th>Nombre</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{accounts.map((account) => <tr key={account.id}><td>{presentAdminValue(account.platform)}</td><td>{account.displayName}</td><td><span className={`pill ${account.connectorState === "READY" && account.isActive ? "ok" : account.connectorState === "NOT_CONFIGURED" || account.connectorState === "UNSUPPORTED" ? "warn" : "info"}`}>{accountStatus(account)}</span></td><td><div className="card-actions"><button className="btn-sm ghost" type="button" disabled={busy === account.id} onClick={() => accountAction(account, "edit")}>Editar</button><button className="btn-sm ghost" type="button" disabled={busy === account.id || (!account.isActive && account.connectorState === "UNSUPPORTED")} onClick={() => accountAction(account, "toggle")}>{account.isActive ? "Desactivar" : "Activar"}</button><button className="btn-sm danger" type="button" disabled={busy === account.id} onClick={() => accountAction(account, "delete")}>Eliminar</button></div></td></tr>)}</tbody></table></div> : <AdminEmptyState icon="social" title="Sin cuentas conectadas" description="Registra una cuenta para comenzar a organizar contenidos." />}</section>
    <section className="panel"><h2>Nueva publicación</h2>{usableAccounts.length === 0 ? <p className="muted">Registra y habilita una cuenta con conector disponible primero.</p> : <form onSubmit={createPost}><div className="form-row"><select name="accountId" aria-label="Cuenta para la publicación">{usableAccounts.map((account) => <option value={account.id} key={account.id}>{account.platform} · {account.displayName}</option>)}</select><input name="linkUrl" aria-label="Enlace de la publicación" type="url" placeholder="Enlace (opcional)" /><input name="scheduledAt" aria-label="Fecha y hora de publicación" type="datetime-local" title="Zona horaria America/Guayaquil" /></div><div className="form-row"><label className="btn-sm ghost">{busy === "upload" ? "Preparando…" : "Subir imagen o video"}<input type="file" accept="image/*,video/*" hidden onChange={upload} /></label><input name="mediaUrl" aria-label="URL del contenido multimedia" type="url" value={mediaUrl} onChange={(event) => setMediaUrl(event.target.value)} placeholder="URL del contenido (opcional)" /></div><div className="form-row"><textarea name="caption" aria-label="Texto de la publicación" rows={4} placeholder="Texto de la publicación" required /></div><button type="submit" className="btn-sm" disabled={busy === "post"}>Crear publicación</button><span className="muted"> Sin fecha se guarda como borrador.</span></form>}</section>
    <section className="panel"><h2>Publicaciones</h2>{posts.length === 0 ? <AdminEmptyState icon="social" title="No hay publicaciones" description="Crea un borrador o programa el primer contenido." /> : <div className="table-wrap"><table className="data"><thead><tr><th>Cuenta</th><th>Texto</th><th>Estado</th><th>Programación</th><th>Acciones</th></tr></thead><tbody>{posts.map((post) => <tr key={post.id}><td>{post.account}</td><td>{post.caption.slice(0, 180)}{post.caption.length > 180 ? "…" : ""}</td><td><span className={`pill ${post.status === "PUBLICADO" ? "ok" : post.status === "FALLIDO" ? "err" : post.status === "PROGRAMADO" ? "warn" : "info"}`}>{presentAdminValue(post.status)}</span>{post.error && <div className="muted">{post.error}</div>}</td><td>{post.scheduledAt ? new Intl.DateTimeFormat("es-EC", { dateStyle: "short", timeStyle: "short", timeZone: "America/Guayaquil" }).format(new Date(post.scheduledAt)) : "Borrador"}</td><td><div className="card-actions">{["BORRADOR","PROGRAMADO","FALLIDO","SIMULADO"].includes(post.status) && <><button className="btn-sm ghost" type="button" disabled={busy === post.id} onClick={() => postAction(post, "update")}>Editar</button><button className="btn-sm ghost" type="button" disabled={busy === post.id} onClick={() => postAction(post, "reschedule")}>Reprogramar</button><button className="btn-sm" type="button" disabled={busy === post.id} onClick={() => postAction(post, "publish")}>Publicar</button><button className="btn-sm ghost" type="button" disabled={busy === post.id} onClick={() => postAction(post, "duplicate")}>Duplicar</button><button className="btn-sm danger" type="button" disabled={busy === post.id} onClick={() => postAction(post, "cancel")}>Cancelar</button></>}</div></td></tr>)}</tbody></table></div>}</section>
    <section className="panel"><h2>Recurrencia semanal</h2><p className="muted">Las horas se interpretan siempre en America/Guayaquil. Cada ocurrencia tiene una clave única para evitar duplicados.</p>{usableAccounts.length === 0 ? <p className="muted">No hay una cuenta disponible para crear recurrencias.</p> : <form onSubmit={createSchedule}><div className="form-row"><select name="accountId" aria-label="Cuenta para la recurrencia">{usableAccounts.map((account) => <option key={account.id} value={account.id}>{account.platform} · {account.displayName}</option>)}</select><input name="name" aria-label="Nombre de la recurrencia" placeholder="Nombre de la recurrencia" required /><select name="weekday" aria-label="Día de la semana">{weekdays.map((day, index) => <option value={index} key={day}>{day}</option>)}</select><input name="localTime" aria-label="Hora local de la recurrencia" type="time" required /></div><div className="form-row"><input name="mediaUrl" aria-label="Contenido multimedia recurrente" type="url" placeholder="Contenido multimedia (opcional)" /><input name="linkUrl" aria-label="Enlace recurrente" type="url" placeholder="Enlace (opcional)" /></div><div className="form-row"><textarea name="caption" aria-label="Texto recurrente" rows={3} placeholder="Texto recurrente" required /></div><button type="submit" className="btn-sm" disabled={busy === "schedule"}>Crear recurrencia</button></form>}{schedules.length > 0 ? <div className="table-wrap"><table className="data"><thead><tr><th>Nombre</th><th>Cuenta</th><th>Día y hora</th><th>Próxima ejecución</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{schedules.map((schedule) => <tr key={schedule.id}><td>{schedule.name}</td><td>{schedule.account}</td><td>{weekdays[schedule.weekday]} · {schedule.localTime}</td><td>{new Intl.DateTimeFormat("es-EC", { dateStyle: "short", timeStyle: "short", timeZone: "America/Guayaquil" }).format(new Date(schedule.nextRunAt))}</td><td><span className={`pill ${schedule.isActive ? "ok" : ""}`}>{schedule.isActive ? "Activa" : "Inactiva"}</span></td><td><div className="card-actions"><button type="button" className="btn-sm ghost" disabled={busy === schedule.id} onClick={() => scheduleAction(schedule, "update")}>Editar</button><button type="button" className="btn-sm ghost" disabled={busy === schedule.id} onClick={() => scheduleAction(schedule, schedule.isActive ? "pause" : "resume")}>{schedule.isActive ? "Pausar" : "Reactivar"}</button><button type="button" className="btn-sm danger" disabled={busy === schedule.id || !schedule.isActive} onClick={() => scheduleAction(schedule, "archive")}>Archivar</button></div></td></tr>)}</tbody></table></div> : <AdminEmptyState icon="calendar" title="Sin recurrencias" description="Crea un calendario semanal para automatizar contenidos." />}</section>
  </>;
}
