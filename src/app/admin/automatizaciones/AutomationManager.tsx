"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ecuadorLocalDateTimeToIso, isoToEcuadorLocalInput } from "@/lib/time";
import { presentAdminValue } from "../adminPresentation";

type Course = { id: string; title: string; startsAt: string | null; endsAt: string | null };
type Campaign = { id: string; name: string; code: string; status: string; courseId: string | null; course: string | null; utmCampaign: string | null; startsAt: string | null; endsAt: string | null; enrollments: number; rules: number };
type Rule = { id: string; courseId: string; campaignId: string | null; name: string; trigger: string; offsetMinutes: number; channel: string; subject: string | null; body: string; status: string; enrollmentStatuses: string[]; course: string; campaign: string | null; nextExecutionAt: string | null; lastExecutedAt: string | null; messages: number; requiresStreamUrl: boolean; planKey: string | null };

/** Traduce el disparador y la anticipación a una frase entendible. */
function describeMoment(trigger: string, offsetMinutes: number): string {
  if (trigger === "ON_REGISTRATION") {
    return offsetMinutes === 0 ? "Al inscribirse, de inmediato" : `${formatAnticipation(offsetMinutes)} después de inscribirse`;
  }
  if (trigger === "BEFORE_COURSE") {
    return offsetMinutes === 0 ? "Al comenzar cada sesión" : `${formatAnticipation(offsetMinutes)} antes de cada sesión`;
  }
  return offsetMinutes === 0 ? "Al terminar la última sesión" : `${formatAnticipation(offsetMinutes)} después de la última sesión`;
}

function formatAnticipation(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440} ${minutes / 1440 === 1 ? "día" : "días"}`;
  if (minutes % 60 === 0) return `${minutes / 60} ${minutes / 60 === 1 ? "hora" : "horas"}`;
  return `${minutes} minutos`;
}

async function request(url: string, method: string, body: unknown) {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, data };
}

const enrollmentStatuses = ["INTERESADO", "INSCRITO", "EN_CURSO", "COMPLETADO", "CANCELADO"];

export function AutomationManager({ role, courses, campaigns, rules }: { role: string; courses: Course[]; campaigns: Campaign[]; rules: Rule[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function createCampaign(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy("campaign-new");
    const result = await request("/api/admin/campaigns", "POST", {
      name: data.get("name"), code: data.get("code"), courseId: data.get("courseId") || null,
      status: data.get("status"), utmCampaign: data.get("utmCampaign") || null,
      startsAt: data.get("startsAt") ? ecuadorLocalDateTimeToIso(String(data.get("startsAt"))) : null,
      endsAt: data.get("endsAt") ? ecuadorLocalDateTimeToIso(String(data.get("endsAt"))) : null,
    });
    setBusy(null); setMessage(result.ok ? "Campaña creada." : result.data.error);
    if (result.ok) { form.reset(); router.refresh(); }
  }

  async function campaignStatus(campaign: Campaign, status: string) {
    if (!window.confirm(`¿Cambiar ${campaign.name} a ${presentAdminValue(status)}?`)) return;
    setBusy(campaign.id);
    const result = await request(`/api/admin/campaigns/${campaign.id}`, "PATCH", { status, confirm: true });
    setBusy(null); setMessage(result.ok ? "Campaña actualizada." : result.data.error); if (result.ok) router.refresh();
  }

  async function updateCampaign(event: React.FormEvent<HTMLFormElement>, campaign: Campaign) {
    event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(campaign.id);
    const result = await request(`/api/admin/campaigns/${campaign.id}`, "PATCH", {
      name: data.get("name"), utmCampaign: data.get("utmCampaign") || null,
      startsAt: data.get("startsAt") ? ecuadorLocalDateTimeToIso(String(data.get("startsAt"))) : null,
      endsAt: data.get("endsAt") ? ecuadorLocalDateTimeToIso(String(data.get("endsAt"))) : null,
      confirm: true,
    });
    setBusy(null); setMessage(result.ok ? "Campaña actualizada." : result.data.error); if (result.ok) router.refresh();
  }

  async function applyDefaultPlan(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const courseId = String(data.get("courseId") ?? "");
    const activate = data.get("activate") === "on";
    if (busy) return;
    if (!courseId) { setMessage("Selecciona un curso para aplicar el plan."); return; }
    if (!window.confirm(activate
      ? "¿Aplicar el plan de cinco correos y dejarlo activo? Se programarán también los mensajes de las inscripciones que ya existen en el curso."
      : "¿Aplicar el plan de cinco correos como borrador? Podrás revisarlo antes de activarlo.")) return;
    setBusy("plan");
    setMessage(activate ? "Aplicando el plan y reprogramando las inscripciones existentes…" : "Aplicando el plan…");
    const result = await request("/api/admin/automations/defaults", "POST", { courseId, activate });
    setBusy(null);
    setMessage(result.ok ? String(result.data.message ?? "Plan aplicado.") : String(result.data.error ?? "No se pudo aplicar el plan."));
    if (result.ok) router.refresh();
  }

  async function createRule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); setBusy("rule-new");
    const result = await request("/api/admin/automations", "POST", {
      courseId: data.get("courseId"), campaignId: data.get("campaignId") || null, name: data.get("name"),
      trigger: data.get("trigger"), offsetMinutes: Number(data.get("offsetMinutes")), channel: data.get("channel"),
      subject: data.get("subject") || null, body: data.get("body"), status: data.get("status"),
      requiresStreamUrl: data.get("requiresStreamUrl") === "on",
      enrollmentStatuses: data.getAll("enrollmentStatuses"),
    });
    setBusy(null); setMessage(result.ok ? "Automatización creada." : result.data.error); if (result.ok) { form.reset(); router.refresh(); }
  }

  async function ruleStatus(rule: Rule, status: string) {
    if (!window.confirm(`¿Cambiar ${rule.name} a ${presentAdminValue(status)}? Al pausar o archivar se cancelarán sus mensajes pendientes.`)) return;
    setBusy(rule.id); const result = await request(`/api/admin/automations/${rule.id}`, "PATCH", { status, confirm: true });
    setBusy(null); setMessage(result.ok ? "Automatización actualizada." : result.data.error); if (result.ok) router.refresh();
  }

  async function updateRule(event: React.FormEvent<HTMLFormElement>, rule: Rule) {
    event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(rule.id);
    const result = await request(`/api/admin/automations/${rule.id}`, "PATCH", {
      name: data.get("name"), offsetMinutes: Number(data.get("offsetMinutes")), subject: data.get("subject") || null,
      body: data.get("body"), enrollmentStatuses: data.getAll("enrollmentStatuses"), confirm: true,
    });
    setBusy(null); setMessage(result.ok ? "Contenido de la regla actualizado." : result.data.error); if (result.ok) router.refresh();
  }

  async function deleteRule(rule: Rule) {
    if (!window.confirm(`¿Eliminar la regla ${rule.name}? Los mensajes ya procesados conservarán su historial; los pendientes se cancelarán.`)) return;
    setBusy(rule.id); const result = await request(`/api/admin/automations/${rule.id}`, "DELETE", { confirm: "DELETE_AUTOMATION" });
    setBusy(null); setMessage(result.ok ? (result.data.archived ? "Regla archivada para preservar historial." : "Regla eliminada.") : result.data.error); if (result.ok) router.refresh();
  }

  const format = (value: string | null) => value ? new Intl.DateTimeFormat("es-EC", { dateStyle: "short", timeStyle: "short", timeZone: "America/Guayaquil" }).format(new Date(value)) : "—";

  return <>
    {message && <p className="result-line" role="status">{message}</p>}
    <section className="panel"><h2>Campañas configurables</h2>
      <form onSubmit={createCampaign}><div className="form-row"><input name="name" placeholder="Nombre de campaña" required /><input name="code" placeholder="código-unico" pattern="[a-z0-9][a-z0-9_-]+" required /><select name="courseId" defaultValue=""><option value="">Todos los cursos</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</select><select name="status" defaultValue="DRAFT"><option value="DRAFT">Borrador</option><option value="ACTIVE">Activa</option></select></div><div className="form-row"><input name="utmCampaign" placeholder="UTM campaign" /><label className="field"><span>Inicio</span><input name="startsAt" type="datetime-local" /></label><label className="field"><span>Fin</span><input name="endsAt" type="datetime-local" /></label><button type="submit" className="btn-sm" disabled={busy === "campaign-new"}>Crear campaña</button></div></form>
      <div className="table-wrap"><table className="data"><thead><tr><th>Campaña</th><th>Curso</th><th>Estado</th><th>Uso</th><th>Acciones</th></tr></thead><tbody>{campaigns.map((campaign) => <tr key={campaign.id}><td><strong>{campaign.name}</strong><div className="muted">{campaign.code} · {campaign.utmCampaign ?? "sin UTM"}</div><details><summary>Editar configuración</summary><form onSubmit={(event) => updateCampaign(event, campaign)}><input name="name" defaultValue={campaign.name} required /><input name="utmCampaign" defaultValue={campaign.utmCampaign ?? ""} placeholder="UTM campaign" /><input name="startsAt" type="datetime-local" defaultValue={campaign.startsAt ? isoToEcuadorLocalInput(campaign.startsAt) : ""} /><input name="endsAt" type="datetime-local" defaultValue={campaign.endsAt ? isoToEcuadorLocalInput(campaign.endsAt) : ""} /><button type="submit" className="btn-sm" disabled={busy === campaign.id}>Guardar</button></form></details></td><td>{campaign.course ?? "Todos"}</td><td><span className="pill info">{presentAdminValue(campaign.status)}</span></td><td>{campaign.enrollments} inscripciones · {campaign.rules} reglas</td><td><div className="card-actions">{campaign.status !== "ACTIVE" && <button type="button" className="btn-sm" onClick={() => campaignStatus(campaign, "ACTIVE")}>Activar</button>}{campaign.status === "ACTIVE" && <button type="button" className="btn-sm ghost" onClick={() => campaignStatus(campaign, "PAUSED")}>Pausar</button>}<button type="button" className="btn-sm danger" disabled={busy === campaign.id} onClick={() => campaignStatus(campaign, "ARCHIVED")}>Archivar</button></div></td></tr>)}</tbody></table></div>
    </section>

    <section className="panel"><h2>Plan de correos estándar</h2>
      <p className="muted">Crea de una sola vez los cinco correos automáticos: bienvenida inmediata, recordatorios de 24 horas, 2 horas y 15 minutos antes de cada sesión, y agradecimiento después de la última sesión. Si el curso ya los tiene, no se duplican ni se pierden los textos editados.</p>
      <form onSubmit={applyDefaultPlan}><div className="form-row">
        <select name="courseId" required defaultValue=""><option value="" disabled>Selecciona un curso</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</select>
        <label className="checkbox"><input type="checkbox" name="activate" /><span>Dejar el plan activo (si no, queda en borrador)</span></label>
        <button type="submit" className="btn-sm" disabled={busy !== null}>{busy === "plan" ? "Aplicando…" : "Aplicar plan estándar"}</button>
      </div></form>
    </section>

    <section className="panel"><h2>Nueva regla por curso</h2><form onSubmit={createRule}>
      <div className="form-row"><select name="courseId" required defaultValue=""><option value="" disabled>Selecciona un curso</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</select><select name="campaignId" defaultValue=""><option value="">Sin campaña específica</option>{campaigns.filter((campaign) => campaign.status !== "ARCHIVED").map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select><input name="name" placeholder="Nombre de la regla" required /><select name="status" defaultValue="DRAFT"><option value="DRAFT">Borrador</option><option value="ACTIVE">Activa en simulación</option></select></div>
      <div className="form-row"><label className="field"><span>Momento de envío</span><select name="trigger" defaultValue="ON_REGISTRATION"><option value="ON_REGISTRATION">Al inscribirse</option><option value="BEFORE_COURSE">Antes de cada sesión</option><option value="AFTER_COURSE">Después de la última sesión</option></select></label><label className="field"><span>Anticipación (minutos)</span><input name="offsetMinutes" type="number" min="0" defaultValue="0" required /></label><label className="field"><span>Canal</span><select name="channel" defaultValue="EMAIL"><option value="EMAIL">Correo electrónico</option><option value="WHATSAPP">WhatsApp (pendiente de conexión)</option></select></label><input name="subject" placeholder="Asunto para correo" /></div>
      <textarea name="body" rows={4} placeholder="Mensaje con variables como {{nombre}}, {{curso}}, {{fechaSesion}}, {{horaSesion}}, {{streamUrl}} y {{bloqueEnlace}}" required />
      <p className="muted">Variables disponibles: {"{{nombre}}"}, {"{{apellido}}"}, {"{{curso}}"}, {"{{fecha}}"}, {"{{hora}}"}, {"{{fechaSesion}}"}, {"{{horaSesion}}"}, {"{{sesion}}"}, {"{{modalidad}}"}, {"{{streamUrl}}"}, {"{{bloqueEnlace}}"}, {"{{courseUrl}}"} y {"{{enlace}}"}.</p>
      <label className="checkbox"><input type="checkbox" name="requiresStreamUrl" /><span>Requiere enlace de transmisión (si falta, el mensaje se registra como omitido en lugar de enviarse vacío)</span></label>
      <fieldset><legend>Estados de inscripción incluidos</legend><div className="checkbox-grid">{enrollmentStatuses.map((status) => <label className="checkbox" key={status}><input type="checkbox" name="enrollmentStatuses" value={status} defaultChecked={["INTERESADO","INSCRITO"].includes(status)} /><span>{presentAdminValue(status)}</span></label>)}</div></fieldset>
      <button type="submit" className="btn-sm" disabled={busy === "rule-new"}>Crear automatización</button>
    </form></section>

    <section className="panel"><h2>Reglas configuradas</h2><div className="table-wrap"><table className="data"><thead><tr><th>Regla</th><th>Curso/campaña</th><th>Momento</th><th>Estado</th><th>Ejecuciones</th><th>Acciones</th></tr></thead><tbody>{rules.map((rule) => <tr key={rule.id}><td><strong>{rule.name}</strong><div className="muted">{presentAdminValue(rule.channel)}</div><details><summary>Editar contenido y segmento</summary><form onSubmit={(event) => updateRule(event, rule)}><input name="name" defaultValue={rule.name} required /><input name="offsetMinutes" type="number" min="0" defaultValue={rule.offsetMinutes} required /><input name="subject" defaultValue={rule.subject ?? ""} placeholder="Asunto" /><textarea name="body" rows={4} defaultValue={rule.body} required /><div className="checkbox-grid">{enrollmentStatuses.map((status) => <label className="checkbox" key={status}><input type="checkbox" name="enrollmentStatuses" value={status} defaultChecked={rule.enrollmentStatuses.includes(status)} /><span>{presentAdminValue(status)}</span></label>)}</div><button type="submit" className="btn-sm" disabled={busy === rule.id}>Guardar cambios</button></form></details></td><td>{rule.course}<div className="muted">{rule.campaign ?? "Todas las campañas"}</div></td><td>{describeMoment(rule.trigger, rule.offsetMinutes)}{rule.requiresStreamUrl && <div className="muted">Necesita enlace de transmisión</div>}{rule.planKey && <div className="muted">Parte del plan estándar</div>}</td><td><span className={`pill ${rule.status === "ACTIVE" ? "ok" : rule.status === "PAUSED" ? "warn" : "info"}`}>{presentAdminValue(rule.status)}</span></td><td>{rule.messages} mensajes<div className="muted">Próxima: {format(rule.nextExecutionAt)}<br />Última: {format(rule.lastExecutedAt)}</div></td><td><div className="card-actions">{rule.status !== "ACTIVE" && <button type="button" className="btn-sm" disabled={busy === rule.id} onClick={() => ruleStatus(rule, "ACTIVE")}>Activar</button>}{rule.status === "ACTIVE" && <button type="button" className="btn-sm ghost" disabled={busy === rule.id} onClick={() => ruleStatus(rule, "PAUSED")}>Pausar</button>}<button type="button" className="btn-sm ghost" disabled={busy === rule.id} onClick={() => ruleStatus(rule, "ARCHIVED")}>Archivar</button>{role === "ADMIN" && <button type="button" className="btn-sm danger" disabled={busy === rule.id} onClick={() => deleteRule(rule)}>Eliminar</button>}</div></td></tr>)}</tbody></table></div></section>
  </>;
}
