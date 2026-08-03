"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AdminEmptyState } from "../../AdminEmptyState";
import { presentAdminValue } from "../../adminPresentation";
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
  const canEdit = role === "ADMIN" || role === "VENTAS";

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const data = new FormData(event.currentTarget);
    const stage = String(data.get("stage"));
    const lostReason = String(data.get("lostReason") || "").trim();
    const sensitiveStageChange = stage !== lead.stage && ["CLIENTE", "PERDIDO"].includes(stage);
    if (stage === "PERDIDO" && !lostReason) { setBusy(false); setMessage("Indica el motivo de pérdida."); return; }
    if (sensitiveStageChange && !window.confirm(stage === "CLIENTE" ? "¿Confirmas el cierre como cliente? Esto no emite certificados." : "¿Confirmas el cierre como perdido?")) { setBusy(false); return; }
    const result = await jsonRequest(`/api/admin/leads/${lead.id}`, "PATCH", {
      firstName: data.get("firstName"),
      lastName: data.get("lastName"),
      email: data.get("email"),
      phone: data.get("phone"),
      stage,
      assignedToId: data.get("assignedToId") || null,
      lostReason: lostReason || null,
      nextActionAt: data.get("nextActionAt") ? ecuadorLocalDateTimeToIso(String(data.get("nextActionAt"))) : null,
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

  async function complete(enrollmentId: string) {
    if (!window.confirm("¿Confirmas que el curso fue completado? Se preparará el envío a Finance, sin emitir certificados desde el CRM.")) return;
    setBusy(true);
    const result = await jsonRequest(`/api/admin/enrollments/${enrollmentId}/complete`, "POST", { confirm: true });
    setBusy(false);
    setMessage(result.ok ? (result.data.simulated ? "Finalización registrada. Envío a Finance simulado de forma segura." : "Inscripción enviada a Finance.") : result.data.error);
    router.refresh();
  }

  async function addEnrollment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (!window.confirm("¿Registrar esta relación con el curso? Un interés no equivale a una inscripción confirmada.")) return;
    setBusy(true);
    const result = await jsonRequest("/api/admin/enrollments", "POST", {
      leadId: lead.id,
      courseId: data.get("courseId"),
      status: data.get("status"),
      confirm: true,
    });
    setBusy(false);
    setMessage(result.ok ? "Inscripción creada." : result.data.error);
    if (result.ok) {
      form.reset();
      router.refresh();
    }
  }

  return (
    <>
      <div className="toolbar">
        {lead.phone && <a className="btn-sm" href={`https://wa.me/${lead.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">Abrir WhatsApp ↗</a>}
        {lead.email && <a className="btn-sm ghost" href={`mailto:${lead.email}`}>Abrir correo</a>}
        {canEdit && <button type="button" className="btn-sm ghost" onClick={archive}>{lead.isArchived ? "Restaurar" : "Archivar"}</button>}
        {message && <span className="result-line" role="status">{message}</span>}
      </div>

      <div className="grid">
        <form className="panel" onSubmit={save}>
          <h2>Datos personales y comerciales</h2>
          <div className="form-row"><input name="firstName" aria-label="Nombres" defaultValue={lead.firstName ?? ""} placeholder="Nombres" disabled={!canEdit} /><input name="lastName" aria-label="Apellidos" defaultValue={lead.lastName ?? ""} placeholder="Apellidos" disabled={!canEdit} /></div>
          <div className="form-row"><input name="email" aria-label="Correo electrónico" type="email" defaultValue={lead.email} disabled={!canEdit} /><input name="phone" aria-label="WhatsApp" defaultValue={lead.phone ?? ""} disabled={!canEdit} /></div>
          <div className="form-row">
            <select name="stage" aria-label="Etapa comercial" defaultValue={lead.stage} disabled={!canEdit}>{["NUEVO","INSCRITO","EN_CURSO","CERTIFICADO","OPORTUNIDAD","CLIENTE","PERDIDO"].map((stage) => <option key={stage} value={stage}>{presentAdminValue(stage)}</option>)}</select>
            <select name="assignedToId" aria-label="Responsable" defaultValue={lead.assignedToId ?? ""} disabled={!canEdit}><option value="">Sin responsable</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select>
          </div>
          <div className="form-row"><input name="lostReason" aria-label="Motivo de pérdida" defaultValue={lead.lostReason ?? ""} placeholder="Motivo de pérdida" disabled={!canEdit} /><input name="nextActionAt" aria-label="Próxima acción" type="datetime-local" defaultValue={lead.nextActionAt ? isoToEcuadorLocalInput(lead.nextActionAt) : ""} disabled={!canEdit} /></div>
          {canEdit && <button type="submit" className="btn-sm" disabled={busy}>Guardar cambios</button>}
          <dl className="detail-list"><dt>Origen</dt><dd>{lead.utmSource ?? lead.source ?? "—"}</dd><dt>Campaña</dt><dd>{lead.utmCampaign ?? "—"}</dd><dt>Medio</dt><dd>{lead.utmMedium ?? "—"}</dd><dt>Contenido UTM</dt><dd>{lead.utmContent ?? "—"}</dd><dt>Término UTM</dt><dd>{lead.utmTerm ?? "—"}</dd><dt>Landing</dt><dd>{lead.landingUrl ? <a href={lead.landingUrl} target="_blank" rel="noreferrer">Abrir landing ↗</a> : "—"}</dd><dt>Referrer</dt><dd>{lead.referrer ? <a href={lead.referrer} target="_blank" rel="noreferrer">Abrir referrer ↗</a> : "—"}</dd><dt>Consentimiento</dt><dd>{lead.consent ? `Registrado${lead.consentAt ? ` · ${new Date(lead.consentAt).toLocaleString("es-EC")}` : ""}` : "No registrado"}</dd><dt>Puntaje comercial</dt><dd>{lead.score}</dd></dl>
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
          <button type="submit" className="btn-sm" disabled={busy}>Crear inscripción</button>
        </form> : null}
        {enrollments.length === 0 ? <AdminEmptyState icon="courses" title="Sin inscripciones" description="Este contacto todavía no está asociado a un curso." /> : <div className="table-wrap"><table className="data"><thead><tr><th>Curso</th><th>Inscripción</th><th>Atribución</th><th>Finance</th><th>Certificado</th><th>Acciones</th></tr></thead><tbody>{enrollments.map((item) => <tr key={item.id}><td><a href={item.course.officialCourseUrl} target="_blank" rel="noreferrer">{item.course.title} ↗</a></td><td><span className="pill info">{presentAdminValue(item.status)}</span></td><td>{item.utmSource ?? item.source ?? "Orgánico"}<div className="muted">{[item.utmCampaign, item.utmContent, item.utmTerm].filter(Boolean).join(" · ")}</div>{item.landingUrl ? <a className="muted" href={item.landingUrl} target="_blank" rel="noreferrer">Landing ↗</a> : null}</td><td><span className="pill">{presentAdminValue(item.financeStatus)}</span>{item.financeInscripcionId && <div className="muted">{item.financeInscripcionId}</div>}</td><td>{presentAdminValue(item.certificateStatus)}</td><td>{role === "ADMIN" && item.status !== "COMPLETADO" && <button type="button" className="btn-sm ghost" disabled={busy} onClick={() => complete(item.id)}>Marcar curso completado</button>}{item.course.moodleCourseUrl && <a className="btn-sm ghost" href={item.course.moodleCourseUrl} target="_blank" rel="noreferrer">Abrir campus ↗</a>}</td></tr>)}</tbody></table></div>}
      </section>
    </>
  );
}
