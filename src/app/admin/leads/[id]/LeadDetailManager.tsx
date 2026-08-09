"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AdminEmptyState } from "../../AdminEmptyState";
import { AdminActionMenu } from "../../AdminActionMenu";
import { presentAdminValue } from "../../adminPresentation";
import { useFeedback } from "../../Feedback";

type LeadDetail = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  email: string;
  phone: string | null;
  stage: string;
  source: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  landingUrl: string | null;
  referrer: string | null;
  consent: boolean;
  consentAt: string | null;
  classification: string;
  isArchived: boolean;
  assignedToId: string | null;
  lostReason: string | null;
  nextActionAt: string | null;
  score: number;
};

type Enrollment = {
  id: string;
  status: string;
  financeStatus: string;
  certificateStatus: string;
  financeInscripcionId: string | null;
  moodleCompletionDate: string | null;
  source: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  landingUrl: string | null;
  referrer: string | null;
  course: { title: string; officialCourseUrl: string; moodleCourseUrl: string | null };
};

async function jsonRequest(url: string, method: string, body: unknown) {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, data };
}

/** La situacion real de una inscripcion, sin el pill ambiguo "Interesado". */
const SITUACION: Record<string, string> = {
  INTERESADO: "Interés registrado",
  INSCRITO: "Inscrito",
  EN_CURSO: "En curso",
  COMPLETADO: "Completado",
  CANCELADO: "Cancelado",
};

function landingPresentation(value: string | null): { label: string; href: string | null } {
  if (!value) return { label: "No registrada", href: null };
  try {
    const url = new URL(value);
    return url.pathname === "/"
      ? { label: `Sitio web ${url.hostname}`, href: value }
      : { label: "Ver página de origen ↗", href: value };
  } catch {
    return { label: "Origen registrado", href: null };
  }
}

function formatEcuadorDateTime(value: string): string {
  const parts = new Intl.DateTimeFormat("es-EC", {
    timeZone: "America/Guayaquil",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("day")}/${part("month")}/${part("year")}, ${part("hour")}:${part("minute")}:${part("second")}`;
}

export function LeadDetailManager({
  lead,
  enrollments,
  interestCourse,
  courses,
  role,
}: {
  lead: LeadDetail;
  enrollments: Enrollment[];
  interestCourse: { id: string; title: string } | null;
  courses: { id: string; title: string }[];
  role: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { confirm } = useFeedback();
  const canEdit = role === "ADMIN" || role === "VENTAS";
  const canDelete = role === "ADMIN";
  const isTechnical = role === "ADMIN";
  const isRealContact = !["TEST", "DEMO"].includes(lead.classification);
  const landing = landingPresentation(lead.landingUrl);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const data = new FormData(event.currentTarget);
    const stage = String(data.get("stage"));
    const sensitiveStageChange = stage !== lead.stage && ["CLIENTE", "PERDIDO"].includes(stage);
    if (sensitiveStageChange) {
      const ok = await confirm({
        title: stage === "CLIENTE" ? "Marcar como cliente" : "Marcar como perdido",
        body: stage === "CLIENTE"
          ? "Se registra el cierre comercial. No emite ningún certificado."
          : "El contacto deja de considerarse activo. Sus mensajes ya enviados se conservan.",
        confirmLabel: "Confirmar",
      });
      if (!ok) { setBusy(false); return; }
    }
    // Responsable, clasificación y motivo de pérdida ya no se editan desde
    // aquí: sus campos salieron de la ficha. Enviarlos como null borraría el
    // valor guardado, así que sencillamente no se mandan.
    const result = await jsonRequest(`/api/admin/leads/${lead.id}`, "PATCH", {
      firstName: data.get("firstName"),
      lastName: data.get("lastName"),
      email: data.get("email"),
      phone: data.get("phone"),
      stage,
      confirm: sensitiveStageChange,
    });
    setBusy(false);
    setMessage(result.ok ? "Contacto actualizado." : result.data.error);
    if (result.ok) router.refresh();
  }

  async function archive() {
    const action = lead.isArchived ? "restaurar" : "archivar";
    if (!window.confirm(`¿Quieres ${action} a ${lead.fullName}?`)) return;
    const result = await jsonRequest(`/api/admin/leads/${lead.id}`, "PATCH", { isArchived: !lead.isArchived, confirm: true });
    setMessage(result.ok ? `Contacto ${lead.isArchived ? "restaurado" : "archivado"}.` : result.data.error);
    router.refresh();
  }

  async function deleteContact() {
    if (!canDelete || busy) return;
    // Un contacto real exige un aviso previo: se borra a una persona y todo su
    // historial de inscripciones y mensajes, y no hay deshacer.
    if (isRealContact && !window.confirm(
      `${lead.fullName} está clasificado como contacto REAL.

Eliminarlo borra también sus inscripciones, mensajes y seguimientos. Esta acción no se puede deshacer.

¿Continuar?`,
    )) return;
    const confirmation = window.prompt(`Para confirmar la eliminación escribe exactamente el nombre:
${lead.fullName}`);
    if (confirmation !== lead.fullName) { setMessage("La confirmación no coincide. No se eliminó ningún dato."); return; }
    setBusy(true);
    const result = await jsonRequest(`/api/admin/leads/${lead.id}`, "DELETE", {
      mode: "delete-test",
      confirmName: confirmation,
      acknowledgeRealDeletion: isRealContact,
    });
    setBusy(false);
    if (result.ok) router.replace("/admin/leads");
    else setMessage(result.data.error);
  }
  async function addEnrollment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    // Guardas contra el doble clic: la petición tarda y el botón debe quedar
    // inutilizable mientras tanto para no crear dos inscripciones.
    if (busy) return;
    if (!window.confirm("¿Registrar esta relación con el curso? Un interés no equivale a una inscripción confirmada.")) return;
    setBusy(true);
    setMessage("Creando la inscripción y programando sus mensajes…");
    const result = await jsonRequest("/api/admin/enrollments", "POST", {
      leadId: lead.id,
      courseId: data.get("courseId"),
      status: data.get("status"),
      confirm: true,
    });
    setBusy(false);
    if (!result.ok) {
      setMessage(String(result.data.error ?? "No se pudo crear la inscripción."));
      return;
    }
    // Si la inscripción quedó sin mensajes programados hay que decirlo, no
    // dar por hecho que todo quedó listo.
    const scheduling = result.data.scheduling as { enqueued?: number; omitted?: number } | undefined;
    const warning = result.data.warning as string | null | undefined;
    setMessage(warning
      ? `Inscripción creada, pero atención: ${warning}`
      : `Inscripción creada. Mensajes programados: ${scheduling?.enqueued ?? 0}.`);
    form.reset();
    router.refresh();
  }

  return (
    <>
      <div className="toolbar contact-detail-toolbar">
        {lead.phone && <a className="btn-sm" href={`https://wa.me/${lead.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">Abrir WhatsApp ↗</a>}
        {lead.email && <a className="btn-sm ghost" href={`mailto:${lead.email}`}>Abrir correo</a>}
        {canEdit || canDelete ? <AdminActionMenu label={`Más acciones para ${lead.fullName}`}>
          {canEdit && <button type="button" onClick={archive}>{lead.isArchived ? "Restaurar contacto" : "Archivar contacto"}</button>}
          {canDelete && <button type="button" className="is-danger" disabled={busy} onClick={deleteContact}>{isRealContact ? "Eliminar contacto" : "Eliminar registro de prueba"}</button>}
        </AdminActionMenu> : null}
        {message && <span className="result-line" role="status">{message}</span>}
      </div>

      <div className="lead-grid">
        <form className="panel" onSubmit={save}>
          <h2>Datos personales y comerciales</h2>
          <div className="form-row"><label className="field"><span>Nombres</span><input name="firstName" defaultValue={lead.firstName ?? ""} placeholder="Nombres" disabled={!canEdit} /></label><label className="field"><span>Apellidos</span><input name="lastName" defaultValue={lead.lastName ?? ""} placeholder="Apellidos" disabled={!canEdit} /></label></div>
          <div className="form-row"><label className="field"><span>Correo electrónico</span><input name="email" type="email" defaultValue={lead.email} disabled={!canEdit} /></label><label className="field"><span>WhatsApp</span><input name="phone" defaultValue={lead.phone ?? ""} disabled={!canEdit} /></label></div>
          <label className="field"><span>Etapa comercial</span><select name="stage" defaultValue={lead.stage} disabled={!canEdit}>{["NUEVO","INSCRITO","EN_CURSO","CERTIFICADO","OPORTUNIDAD","CLIENTE","PERDIDO"].map((stage) => <option key={stage} value={stage}>{presentAdminValue(stage)}</option>)}</select></label>
          {canEdit && <button type="submit" className="btn-sm" disabled={busy}>Guardar cambios</button>}
        </form>
        <section className="panel"><h2>Procedencia</h2><dl className="detail-list"><dt>Origen</dt><dd>{lead.utmSource ?? lead.source ?? "Orgánico"}</dd><dt>Página de origen</dt><dd>{landing.href ? <a href={landing.href} target="_blank" rel="noreferrer">{landing.label}</a> : <span className="muted">{landing.label}</span>}</dd><dt>Referencia</dt><dd>{lead.referrer ? <span className="contact-referrer">Sitio de referencia registrado</span> : <span className="muted">No registrada</span>}</dd><dt>Consentimiento</dt><dd>{lead.consent ? `Registrado${lead.consentAt ? ` · ${formatEcuadorDateTime(lead.consentAt)}` : ""}` : "No registrado"}</dd></dl>{isTechnical ? <details className="technical-context"><summary>Contexto técnico de captación</summary><dl className="detail-list"><dt>Campaña</dt><dd>{lead.utmCampaign ?? "—"}</dd><dt>Medio</dt><dd>{lead.utmMedium ?? "—"}</dd><dt>Contenido</dt><dd>{lead.utmContent ?? "—"}</dd><dt>Término</dt><dd>{lead.utmTerm ?? "—"}</dd><dt>Clasificación</dt><dd>{presentAdminValue(lead.classification)}</dd><dt>Puntaje</dt><dd>{lead.score}</dd></dl></details> : null}</section>
      </div>

      <section className="panel">
        <h2>Cursos e inscripciones</h2>
        {interestCourse ? <p className="interest-summary"><span className="pill info">Interés registrado</span><strong>{interestCourse.title}</strong><span className="muted">Aún no equivale a una inscripción confirmada.</span></p> : null}
        {canEdit ? <form className="form-row enrollment-form" onSubmit={addEnrollment}>
          <label className="field"><span>Curso</span><select name="courseId" required defaultValue=""><option value="" disabled>Selecciona un curso</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</select></label>
          <label className="field"><span>Estado inicial</span><select name="status" defaultValue="INSCRITO"><option value="INSCRITO">Inscrito</option><option value="INTERESADO">Interesado</option></select></label>
          <button type="submit" className="btn-sm" disabled={busy}>{busy ? "Creando…" : "Crear inscripción"}</button>
        </form> : null}
        {enrollments.length === 0 ? <AdminEmptyState icon="courses" title="Sin inscripciones confirmadas" description="Este contacto puede tener un interés registrado, pero todavía no está inscrito." /> : <div className="table-wrap"><table className="data"><thead><tr><th>Curso</th><th>Situación</th><th>Origen</th></tr></thead><tbody>{enrollments.map((item) => <tr key={item.id}><td><a href={item.course.officialCourseUrl} target="_blank" rel="noreferrer">{item.course.title} ↗</a></td><td><span className={`status-dot ${item.status === "INSCRITO" || item.status === "COMPLETADO" ? "is-done" : "is-waiting"}`}>{SITUACION[item.status] ?? presentAdminValue(item.status)}</span></td><td>{item.utmSource ?? item.source ?? "Orgánico"}{isTechnical && [item.utmCampaign, item.utmContent, item.utmTerm].some(Boolean) ? <div className="muted">{[item.utmCampaign, item.utmContent, item.utmTerm].filter(Boolean).join(" · ")}</div> : null}{item.landingUrl ? <a className="muted" href={item.landingUrl} target="_blank" rel="noreferrer">Ver origen ↗</a> : null}</td></tr>)}</tbody></table></div>}
      </section>
    </>
  );
}
