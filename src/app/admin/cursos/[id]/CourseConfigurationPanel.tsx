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
  institutionalOfferUrl: string | null;
  upgradeOfferUrl: string | null;
  fullOfferPrice: string | number | null;
  institutionalOfferPrice: string | number | null;
  upgradeOfferPrice: string | number | null;
  institutionalOfferDelayHours: number;
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
        institutionalOfferUrl: data.get("institutionalOfferUrl"),
        upgradeOfferUrl: data.get("upgradeOfferUrl"),
        fullOfferPrice: data.get("fullOfferPrice") || null,
        institutionalOfferPrice: data.get("institutionalOfferPrice") || null,
        upgradeOfferPrice: data.get("upgradeOfferPrice") || null,
        institutionalOfferDelayHours: data.get("institutionalOfferDelayHours") || 24,
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
      {/* Una fila por enlace. En rejilla de tres columnas los campos quedaban
          tan estrechos que no se veia ni el dominio de la URL escrita. */}
      <form className="course-config-form" onSubmit={submit}>
        <div className="config-rows">
          {([
            { campo: "whatsappGroupUrl", etiqueta: "Grupo oficial de WhatsApp", ayuda: "Enlace de invitación al grupo. Se envía 2 minutos después de la inscripción.", marcador: "https://chat.whatsapp.com/…", valor: course.whatsappGroupUrl },
            { campo: "courseCompleteUrl", etiqueta: "Página informativa del curso completo", ayuda: "Página donde se ve contenido, horas, certificado y precio de la versión completa. No es un checkout.", marcador: "https://ra-training.com/cursos/…", valor: course.courseCompleteUrl },
            { campo: "surveyUrl", etiqueta: "Encuesta final", ayuda: "Se envía 48 horas después de terminar la última sesión.", marcador: "https://forms.gle/…", valor: course.surveyUrl },
          ] as const).map((fila) => (
            <label className="config-row" key={fila.campo}>
              <span className="config-row-head">
                <strong>{fila.etiqueta}</strong>
                {statusPill(fila.valor)}
              </span>
              <input
                name={fila.campo}
                type="url"
                defaultValue={fila.valor ?? ""}
                placeholder={fila.marcador}
                disabled={!canEdit || busy}
                aria-label={fila.etiqueta}
              />
              <small>{fila.ayuda}</small>
            </label>
          ))}
        </div>
        {/* Las tres modalidades del MISMO curso de 60 horas. El precio se
            guarda por curso porque el de lanzamiento va a cambiar; ninguna
            decisión del sistema mira el importe para saber qué se compró. */}
        <h3 className="config-subtitulo">Modalidades comerciales</h3>
        <div className="config-rows">
          {([
            {
              clave: "full", etiqueta: "Oferta completa", precio: "fullOfferPrice", precioValor: course.fullOfferPrice,
              urlCampo: null, urlValor: course.courseCompleteUrl,
              ayuda: "Curso de 60 h + certificado institucional + aval externo. Usa la página informativa de arriba.",
            },
            {
              clave: "institucional", etiqueta: "Oferta institucional", precio: "institutionalOfferPrice", precioValor: course.institutionalOfferPrice,
              urlCampo: "institutionalOfferUrl", urlValor: course.institutionalOfferUrl,
              ayuda: "Curso de 60 h + certificado institucional, sin aval externo. Es el destino de la campaña de oferta.",
            },
            {
              clave: "upgrade", etiqueta: "Mejora con aval externo", precio: "upgradeOfferPrice", precioValor: course.upgradeOfferPrice,
              urlCampo: "upgradeOfferUrl", urlValor: course.upgradeOfferUrl,
              ayuda: "Solo para quien ya pagó la institucional. No da acceso nuevo: eleva la certificación.",
            },
          ] as const).map((oferta) => (
            <div className="config-row" key={oferta.clave}>
              <span className="config-row-head">
                <strong>{oferta.etiqueta}</strong>
                {oferta.urlCampo ? statusPill(oferta.urlValor) : null}
              </span>
              <div className="config-oferta">
                <label>
                  <small>Precio (USD)</small>
                  <input
                    name={oferta.precio}
                    type="number"
                    min={0}
                    step="0.01"
                    defaultValue={oferta.precioValor === null ? "" : String(oferta.precioValor)}
                    disabled={!canEdit || busy}
                    aria-label={`Precio de ${oferta.etiqueta}`}
                  />
                </label>
                {oferta.urlCampo ? (
                  <label>
                    <small>URL de destino</small>
                    <input
                      name={oferta.urlCampo}
                      type="url"
                      defaultValue={oferta.urlValor ?? ""}
                      placeholder="https://ra-training.com/…"
                      disabled={!canEdit || busy}
                      aria-label={`URL de ${oferta.etiqueta}`}
                    />
                  </label>
                ) : null}
                {oferta.clave === "institucional" ? (
                  <label>
                    <small>Espera tras el curso (horas)</small>
                    <input
                      name="institutionalOfferDelayHours"
                      type="number"
                      min={0}
                      max={720}
                      defaultValue={course.institutionalOfferDelayHours}
                      disabled={!canEdit || busy}
                      aria-label="Horas de espera antes de la oferta institucional"
                    />
                  </label>
                ) : null}
              </div>
              <small>{oferta.ayuda}</small>
            </div>
          ))}
        </div>

        {canEdit ? <button className="btn-sm" type="submit" disabled={busy}>{busy ? "Guardando..." : "Guardar configuración"}</button> : null}
        {message ? <p className="muted" role="status">{message}</p> : null}
      </form>
    </section>
  );
}
