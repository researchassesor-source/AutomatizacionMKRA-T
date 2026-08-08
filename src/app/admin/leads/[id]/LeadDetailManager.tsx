"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AdminEmptyState } from "../../AdminEmptyState";
import { presentAdminValue } from "../../adminPresentation";
import { useFeedback } from "../../Feedback";
import { ecuadorLocalDateTimeToIso, isoToEcuadorLocalInput } from "@/lib/time";

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

export function LeadDetailManager({
  lead,
  enrollments,
  interestCourse,
  courses,
  users,
  role,
}: {
  lead: LeadDetail;
  enrollments: Enrollment[];
  interestCourse: { id: string; title: string } | null;
  courses: { id: string; title: string }[];
  users: { id: string; name: string }[];
  role: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { confirm } = useFeedback();
  const canEdit = role === "ADMIN" || role === "VENTAS";
  const canDelete = role === "ADMIN";
  const isRealContact = !["TEST", "DEMO"].includes(lead.classification);

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

  async function addNote(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const result = await jsonRequest(`/api/admin/leads/${lead.id}/notes`, "POST", { content: new FormData(form).get("content") });
    setMessage(result.ok ? "Nota agregada." : result.data.error);
    if (result.ok) { form.reset(); router.refresh(); }
  }

  async function addFollowUp(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (!window.confirm("¿Programar este seguimiento con la fecha, tipo y responsable seleccionados?")) return;
    const result = await jsonRequest(`/api/admin/leads/${lead.id}/followups`, "POST", {
      type: data.get("type"),
      dueAt: ecuadorLocalDateTimeToIso(String(data.get("dueAt"))),
      notes: data.get("notes"),
      assignedToId: data.get("assignedToId") || null,
    });
    setMessage(result.ok ? "Seguimiento programado." : result.data.error);
    if (result.ok) { form.reset(); router.refresh(); }
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
      <div className="toolbar">
        {lead.phone && <a className="btn-sm" href={`https://wa.me/${lead.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">Abrir WhatsApp ↗</a>}
        {lead.email && <a className="btn-sm ghost" href={`mailto:${lead.email}`}>Abrir correo</a>}
        {canEdit && <button type="button" className="btn-sm ghost" onClick={archive}>{lead.isArchived ? "Restaurar" : "Archivar"}</button>}
        {canDelete && <button type="button" className="btn-sm danger" disabled={busy} onClick={deleteContact}>{isRealContact ? "Eliminar contacto" : "Eliminar registro de prueba"}</button>}
        {message && <span className="result-line" role="status">{message}</span>}
      </div>

      <div className="grid">
        <form className="panel" onSubmit={save}>
          <h2>Datos personales y comerciales</h2>
          <div className="form-row"><input name="firstName" aria-label="Nombres" defaultValue={lead.firstName ?? ""} placeholder="Nombres" disabled={!canEdit} /><input name="lastName" aria-label="Apellidos" defaultValue={lead.lastName ?? ""} placeholder="Apellidos" disabled={!canEdit} /></div>
          <div className="form-row"><input name="email" aria-label="Correo electrónico" type="email" defaultValue={lead.email} disabled={!canEdit} /><input name="phone" aria-label="WhatsApp" defaultValue={lead.phone ?? ""} disabled={!canEdit} /></div>
          <div className="form-row">
            <select name="stage" aria-label="Etapa comercial" defaultValue={lead.stage} disabled={!canEdit}>{["NUEVO","INSCRITO","EN_CURSO","CERTIFICADO","OPORTUNIDAD","CLIENTE","PERDIDO"].map((stage) => <option key={stage} value={stage}>{presentAdminValue(stage)}</option>)}</select>
            
          </div>
          <div className="form-row"><label className="field"><span>Clasificación</span></label></div>
          <div className="form-row"></div>
          {canEdit && <button type="submit" className="btn-sm" disabled={busy}>Guardar cambios</button>}
          <dl className="detail-list"><dt>Procedencia</dt><dd>{lead.utmSource ?? lead.source ?? "—"}</dd><dt>Página de origen</dt><dd>{lead.landingUrl ? <a href={lead.landingUrl} target="_blank" rel="noreferrer">Abrir página ↗</a> : "—"}</dd><dt>Consentimiento</dt><dd>{lead.consent ? `Registrado${lead.consentAt ? ` · ${new Date(lead.consentAt).toLocaleString("es-EC")}` : ""}` : "No registrado"}</dd><dt>Puntaje</dt><dd>{lead.score}</dd></dl>
        </form>

        <section>
          {canEdit && <form className="panel" onSubmit={addNote}><h2>Agregar nota</h2><div className="form-row"><textarea name="content" aria-label="Contenido de la nota" rows={3} placeholder="Contexto de la conversación o acuerdo…" required /></div><button type="submit" className="btn-sm">Guardar nota</button></form>}
          {canEdit && <form className="panel" onSubmit={addFollowUp}><h2>Programar seguimiento</h2><div className="form-row"><select name="type" aria-label="Tipo de seguimiento" defaultValue="WHATSAPP">{["LLAMADA","WHATSAPP","CORREO","REUNION","RECORDATORIO","OTRO"].map((type) => <option key={type} value={type}>{presentAdminValue(type)}</option>)}</select><input name="dueAt" aria-label="Fecha y hora del seguimiento" type="datetime-local" required /></div><div className="form-row"><select name="assignedToId" aria-label="Responsable del seguimiento"><option value="">Responsable actual</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select><input name="notes" aria-label="Objetivo del seguimiento" placeholder="Objetivo del seguimiento" /></div><button type="submit" className="btn-sm">Programar</button></form>}
        </section>
      </div>

      <section className="panel">
        <h2>Cursos e inscripciones</h2>
        {interestCourse ? <p className="muted">Curso de interés inicial: <strong>{interestCourse.title}</strong>. Esto no constituye una inscripción.</p> : null}
        {canEdit ? <form className="form-row enrollment-form" onSubmit={addEnrollment}>
          <label className="field"><span>Curso</span><select name="courseId" required defaultValue=""><option value="" disabled>Selecciona un curso</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</select></label>
          <label className="field"><span>Estado inicial</span><select name="status" defaultValue="INSCRITO"><option value="INSCRITO">Inscrito</option><option value="INTERESADO">Interesado</option></select></label>
          <button type="submit" className="btn-sm" disabled={busy}>{busy ? "Creando…" : "Crear inscripción"}</button>
        </form> : null}
        {enrollments.length === 0 ? <AdminEmptyState icon="courses" title="Sin inscripciones" description="Este contacto todavía no está asociado a un curso." /> : <div className="table-wrap"><table className="data"><thead><tr><th>Curso</th><th>Estado</th><th>Origen</th></tr></thead><tbody>{enrollments.map((item) => <tr key={item.id}><td><a href={item.course.officialCourseUrl} target="_blank" rel="noreferrer">{item.course.title} ↗</a></td><td><span className="pill info">{presentAdminValue(item.status)}</span></td><td>{item.utmSource ?? item.source ?? "Orgánico"}<div className="muted">{[item.utmCampaign, item.utmContent, item.utmTerm].filter(Boolean).join(" · ")}</div>{item.landingUrl ? <a className="muted" href={item.landingUrl} target="_blank" rel="noreferrer">Landing ↗</a> : null}</td></tr>)}</tbody></table></div>}
      </section>
    </>
  );
}
