"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminEmptyState } from "../AdminEmptyState";
import { ecuadorLocalDateTimeToIso, isoToEcuadorLocalInput } from "@/lib/time";

export type CourseRow = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  category: string | null;
  officialCourseUrl: string;
  courseCompleteUrl: string | null;
  whatsappGroupUrl: string | null;
  surveyUrl: string | null;
  moodleCourseUrl: string | null;
  financeServiceId: string | null;
  imageUrl: string | null;
  price: number | null;
  duration: string | null;
  modality: string | null;
  startsAt: string | null;
  endsAt: string | null;
  isFree: boolean;
  isPublished: boolean;
  acceptsRegistrations: boolean;
  isLeadMagnet: boolean;
  hasCertificate: boolean;
  displayOrder: number;
};

const emptyCourse: Omit<CourseRow, "id"> = {
  slug: "",
  title: "",
  subtitle: "",
  description: "",
  category: "",
  officialCourseUrl: "https://ra-training.com/courses-1/",
  courseCompleteUrl: "",
  whatsappGroupUrl: "",
  surveyUrl: "",
  moodleCourseUrl: "",
  financeServiceId: "",
  imageUrl: "",
  price: null,
  duration: "",
  modality: "Virtual",
  startsAt: null,
  endsAt: null,
  isFree: false,
  isPublished: false,
  acceptsRegistrations: false,
  isLeadMagnet: false,
  hasCertificate: false,
  displayOrder: 0,
};

export function CourseManager({
  courses,
  canEdit,
  startCreating,
  closeHref,
}: {
  courses: CourseRow[];
  canEdit: boolean;
  startCreating: boolean;
  closeHref: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<CourseRow | null>(null);
  const [creating, setCreating] = useState(startCreating);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const current = editing ?? (creating ? ({ id: "", ...emptyCourse } as CourseRow) : null);

  useEffect(() => {
    if (startCreating && canEdit) {
      setCreating(true);
      setEditing(null);
    }
  }, [canEdit, startCreating]);

  function closeEditor() {
    setEditing(null);
    setCreating(false);
    if (startCreating) router.replace(closeHref, { scroll: false });
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const data = new FormData(event.currentTarget);
    const payload = {
      slug: data.get("slug"),
      title: data.get("title"),
      subtitle: data.get("subtitle"),
      description: data.get("description"),
      category: data.get("category"),
      officialCourseUrl: data.get("officialCourseUrl"),
      courseCompleteUrl: data.get("courseCompleteUrl"),
      whatsappGroupUrl: data.get("whatsappGroupUrl"),
      surveyUrl: data.get("surveyUrl"),
      moodleCourseUrl: data.get("moodleCourseUrl"),
      financeServiceId: data.get("financeServiceId"),
      imageUrl: data.get("imageUrl"),
      price: data.get("price"),
      duration: data.get("duration"),
      modality: data.get("modality"),
      startsAt: data.get("startsAt") ? ecuadorLocalDateTimeToIso(String(data.get("startsAt"))) : "",
      endsAt: data.get("endsAt") ? ecuadorLocalDateTimeToIso(String(data.get("endsAt"))) : "",
      displayOrder: Number(data.get("displayOrder") || 0),
      isFree: data.get("isFree") === "on",
      isPublished: data.get("isPublished") === "on",
      acceptsRegistrations: data.get("acceptsRegistrations") === "on",
      isLeadMagnet: data.get("isLeadMagnet") === "on",
      hasCertificate: data.get("hasCertificate") === "on",
    };
    const response = await fetch(editing ? `/api/admin/courses/${editing.id}` : "/api/admin/courses", {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) {
      setMessage(result.error ?? "No se pudo guardar el curso.");
      return;
    }
    closeEditor();
    setMessage("Curso guardado correctamente.");
    router.refresh();
  }

  async function togglePublication(course: CourseRow) {
    const nextPublished = !course.isPublished;
    if (course.isPublished && !window.confirm(`¿Desactivar “${course.title}”? Dejará de mostrarse públicamente.`)) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/courses/${course.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: course.slug,
          title: course.title,
          subtitle: course.subtitle ?? "",
          description: course.description ?? "",
          category: course.category ?? "",
          officialCourseUrl: course.officialCourseUrl,
          courseCompleteUrl: course.courseCompleteUrl ?? "",
          whatsappGroupUrl: course.whatsappGroupUrl ?? "",
          surveyUrl: course.surveyUrl ?? "",
          moodleCourseUrl: course.moodleCourseUrl ?? "",
          financeServiceId: course.financeServiceId ?? "",
          imageUrl: course.imageUrl ?? "",
          price: course.price ?? "",
          duration: course.duration ?? "",
          modality: course.modality ?? "",
          startsAt: course.startsAt ?? "",
          endsAt: course.endsAt ?? "",
          displayOrder: course.displayOrder,
          isFree: course.isFree,
          isPublished: nextPublished,
          acceptsRegistrations: course.acceptsRegistrations,
          isLeadMagnet: course.isLeadMagnet,
          hasCertificate: course.hasCertificate,
          confirm: !nextPublished,
        }),
      });
      const result = await response.json().catch(() => ({}));
      setMessage(response.ok ? (nextPublished ? "Curso activado." : "Curso desactivado.") : result.error ?? "No se pudo actualizar el curso.");
      if (response.ok) router.refresh();
    } catch {
      setMessage("No se pudo conectar con el servidor.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {message && <p className={message.includes("correctamente") || message.includes("activado") || message.includes("desactivado") ? "result-line form-success" : "result-line"} role="status">{message}</p>}
      {current && (
        <form className="panel" onSubmit={save}>
          <div className="page-header"><h2>{editing ? "Editar curso" : "Nuevo curso"}</h2></div>
          <div className="form-row">
            <input name="title" aria-label="Título" defaultValue={current.title} placeholder="Título" required />
            <input name="slug" aria-label="Identificador del curso" defaultValue={current.slug} placeholder="identificador-del-curso" required />
            <input name="category" aria-label="Categoría" defaultValue={current.category ?? ""} placeholder="Categoría" />
            <input name="duration" aria-label="Duración" defaultValue={current.duration ?? ""} placeholder="Duración" />
            <input name="modality" aria-label="Modalidad" defaultValue={current.modality ?? ""} placeholder="Modalidad" />
            <input name="price" aria-label="Precio" type="number" min="0" step="0.01" defaultValue={current.price ?? ""} placeholder="Precio" />
            <input name="displayOrder" aria-label="Orden de presentación" type="number" min="0" defaultValue={current.displayOrder} placeholder="Orden" />
          </div>
          <div className="form-row">
            <label className="field"><span>Inicio <small>(opcional)</small></span><input name="startsAt" aria-label="Fecha y hora de inicio" type="datetime-local" defaultValue={current.startsAt ? isoToEcuadorLocalInput(current.startsAt) : ""} /></label>
            <label className="field"><span>Cierre <small>(opcional)</small></span><input name="endsAt" aria-label="Fecha y hora de cierre" type="datetime-local" defaultValue={current.endsAt ? isoToEcuadorLocalInput(current.endsAt) : ""} /></label>
          </div>
          <div className="form-row">
            <input name="subtitle" aria-label="Subtítulo" defaultValue={current.subtitle ?? ""} placeholder="Subtítulo" />
            <input name="officialCourseUrl" aria-label="URL oficial" type="url" defaultValue={current.officialCourseUrl} placeholder="URL oficial" required />
            <input name="courseCompleteUrl" aria-label="URL curso completo" type="url" defaultValue={current.courseCompleteUrl ?? ""} placeholder="URL curso completo (opcional)" />
            <input name="whatsappGroupUrl" aria-label="URL grupo WhatsApp" type="url" defaultValue={current.whatsappGroupUrl ?? ""} placeholder="URL grupo WhatsApp (opcional)" />
            <input name="surveyUrl" aria-label="URL de encuesta" type="url" defaultValue={current.surveyUrl ?? ""} placeholder="URL de encuesta final (opcional)" />
            <input name="moodleCourseUrl" aria-label="URL del campus" type="url" defaultValue={current.moodleCourseUrl ?? ""} placeholder="URL del campus (opcional)" />
            <input name="imageUrl" aria-label="URL de imagen" type="url" defaultValue={current.imageUrl ?? ""} placeholder="URL de imagen (opcional)" />
          </div>
          <div className="form-row">
            <label className="field">
              <span>ID de Servicio en Finance <small>(opcional)</small></span>
              <input
                name="financeServiceId"
                aria-label="ID de Servicio en Finance"
                defaultValue={current.financeServiceId ?? ""}
                placeholder="Vacío = Finance empareja por nombre del curso"
              />
              <small>
                Vincula este curso a un Servicio exacto en Finance, sin depender del nombre. Déjalo vacío
                mientras el emparejamiento automático por nombre siga funcionando.
              </small>
            </label>
          </div>
          <div className="form-row"><textarea name="description" aria-label="Descripción" defaultValue={current.description ?? ""} placeholder="Descripción" rows={3} /></div>
          <div className="toolbar">
            {[
              ["isPublished", "Publicado", current.isPublished],
              ["acceptsRegistrations", "Acepta registros", current.acceptsRegistrations],
              ["isFree", "Gratuito", current.isFree],
              ["isLeadMagnet", "Recurso de captación", current.isLeadMagnet],
              ["hasCertificate", "Incluye certificado", current.hasCertificate],
            ].map(([name, label, checked]) => (
              <label className="checkbox" key={String(name)}><input name={String(name)} type="checkbox" defaultChecked={Boolean(checked)} /><span>{String(label)}</span></label>
            ))}
          </div>
          <div className="card-actions">
            <button type="submit" className="btn-sm" disabled={busy}>{busy ? "Guardando…" : "Guardar"}</button>
            <button className="btn-sm ghost" type="button" onClick={closeEditor}>Cancelar</button>
          </div>
          {message && <p className="form-error" role="alert">{message}</p>}
        </form>
      )}
      <details className="panel course-admin-details">
        <summary><span><strong>Administración de cursos</strong><small>Edita información, publicación y disponibilidad de registro.</small></span><span>Mostrar herramientas</span></summary>
        <div className="course-admin-details-body">
        {courses.length === 0 ? <AdminEmptyState icon="courses" title="No hay cursos con estos filtros" description="Ajusta los criterios o crea un nuevo curso si tienes permisos." /> : (
          <div className="table-wrap">
            <table className="data course-admin-table">
              <thead><tr><th>Curso</th><th>Categoría</th><th>Modalidad / duración</th><th>Precio</th><th>Estado</th><th>Página</th><th>Acciones</th></tr></thead>
              <tbody>{courses.map((course) => (
                <tr key={course.id}>
                  <td><strong>{course.title}</strong><div className="muted">{course.slug}</div></td>
                  <td>{course.category?.trim() || "Sin categoría"}</td>
                  <td>{course.modality ?? "—"}<div className="muted">{course.duration ?? "Duración sin definir"}</div></td>
                  <td>{course.isFree ? "Gratuito" : course.price === null ? "—" : `$${course.price}`}</td>
                  <td><span className={`pill ${course.isPublished ? "ok" : ""}`}>{course.isPublished ? "Activo" : "Inactivo"}</span><div className="muted">{course.acceptsRegistrations ? "Registro abierto" : "Registro cerrado"}</div></td>
                  <td><a href={course.officialCourseUrl} target="_blank" rel="noreferrer">Ver página ↗</a></td>
                  <td>{canEdit && <div className="card-actions"><button className="btn-sm ghost" type="button" onClick={() => { setEditing(course); setCreating(false); }}>Editar</button><button className={`btn-sm ${course.isPublished ? "danger" : "ghost"}`} type="button" disabled={busy} onClick={() => togglePublication(course)}>{course.isPublished ? "Desactivar" : "Activar"}</button></div>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        </div>
      </details>
    </>
  );
}
