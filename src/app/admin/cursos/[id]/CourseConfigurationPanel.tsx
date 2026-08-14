"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type CourseConfiguration = {
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
  imageUrl: string | null;
  price: string | number | null;
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

function stateLabel(value: string | null) {
  return value?.trim() ? "Configurado" : "Pendiente";
}

function statusPill(value: string | null) {
  const configured = Boolean(value?.trim());
  return <span className={`pill ${configured ? "ok" : ""}`}>{configured ? "Configurado" : "Pendiente"}</span>;
}

export function CourseConfigurationPanel({ course, canEdit }: { course: CourseConfiguration; canEdit: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit || busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setMessage(null);
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
        courseCompleteUrl: data.get("courseCompleteUrl"),
        whatsappGroupUrl: data.get("whatsappGroupUrl"),
        surveyUrl: data.get("surveyUrl"),
        moodleCourseUrl: course.moodleCourseUrl ?? "",
        imageUrl: course.imageUrl ?? "",
        price: course.price === null ? "" : String(course.price),
        duration: course.duration ?? "",
        modality: course.modality ?? "",
        startsAt: course.startsAt ?? "",
        endsAt: course.endsAt ?? "",
        isFree: course.isFree,
        isPublished: course.isPublished,
        acceptsRegistrations: course.acceptsRegistrations,
        isLeadMagnet: course.isLeadMagnet,
        hasCertificate: course.hasCertificate,
        displayOrder: course.displayOrder,
      }),
    });
    const result = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setMessage(result.error ?? "No se pudo guardar la configuración.");
      return;
    }
    setMessage("Configuración guardada.");
    router.refresh();
  }

  return (
    <section className="panel">
      <h2>Configuración</h2>
      <p className="muted" style={{ marginTop: -8, marginBottom: 18 }}>
        Enlaces propios de este curso para comunicaciones automáticas.
      </p>
      <form className="course-config-form" onSubmit={submit}>
        <div className="data-grid">
          <label>
            <span>Grupo oficial de WhatsApp</span>
            <input name="whatsappGroupUrl" type="url" defaultValue={course.whatsappGroupUrl ?? ""} placeholder="https://chat.whatsapp.com/..." disabled={!canEdit || busy} aria-label="Grupo oficial de WhatsApp" />
            <small>{stateLabel(course.whatsappGroupUrl)}</small>
          </label>
          <label>
            <span>Página informativa del curso completo</span>
            <input name="courseCompleteUrl" type="url" defaultValue={course.courseCompleteUrl ?? ""} placeholder="https://ra-training.com/..." disabled={!canEdit || busy} aria-label="Página informativa del curso completo" />
            <small>{stateLabel(course.courseCompleteUrl)}</small>
          </label>
          <label>
            <span>Encuesta final</span>
            <input name="surveyUrl" type="url" defaultValue={course.surveyUrl ?? ""} placeholder="https://..." disabled={!canEdit || busy} aria-label="Encuesta final" />
            <small>{stateLabel(course.surveyUrl)}</small>
          </label>
        </div>
        <div className="summary-line">
          <span>Grupo: {statusPill(course.whatsappGroupUrl)}</span>
          <span>Curso completo: {statusPill(course.courseCompleteUrl)}</span>
          <span>Encuesta: {statusPill(course.surveyUrl)}</span>
        </div>
        {canEdit ? <button className="btn-sm" type="submit" disabled={busy}>{busy ? "Guardando..." : "Guardar configuración"}</button> : null}
        {message ? <p className="muted" role="status">{message}</p> : null}
      </form>
    </section>
  );
}
