"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ecuadorLocalDateTimeToIso } from "@/lib/time";
import { useFeedback } from "../Feedback";

/**
 * Programar la primera sesion de un curso.
 *
 * Es el desbloqueo del CRM: sin fecha no se puede calcular ningun recordatorio,
 * y hasta ahora ponerla exigia entender el panel de calendario. Aqui son cuatro
 * campos y el enlace, que puede quedarse vacio a proposito porque muchas veces
 * la reunion todavia no esta creada.
 *
 * La distincion importa: la FECHA es obligatoria porque de ella dependen los
 * cinco avisos; el ENLACE puede llegar despues y solo bloquea los dos avisos
 * de acceso.
 */
const DURACIONES = [60, 90, 120, 180, 240];

export function ScheduleSessionButton({
  courseId,
  courseTitle,
  enrollments,
  modality,
  label = "Programar sesión",
  variant = "primary",
}: {
  courseId: string;
  courseTitle: string;
  enrollments: number;
  modality: string | null;
  label?: string;
  variant?: "primary" | "ghost";
}) {
  const router = useRouter();
  const { toast } = useFeedback();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const data = new FormData(event.currentTarget);
    const fecha = String(data.get("fecha") ?? "");
    const hora = String(data.get("hora") ?? "");
    if (!fecha || !hora) {
      setError("Indica la fecha y la hora de la sesión.");
      return;
    }
    const duracion = Number(data.get("duracion") ?? 120);
    const startAt = ecuadorLocalDateTimeToIso(`${fecha}T${hora}`);
    if (!startAt) {
      setError("La fecha o la hora no son válidas.");
      return;
    }
    const endAt = new Date(new Date(startAt).getTime() + duracion * 60_000).toISOString();
    const streamUrl = String(data.get("enlace") ?? "").trim();

    setSaving(true);
    try {
      const response = await fetch(`/api/admin/courses/${courseId}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startAt, endAt, streamUrl: streamUrl || undefined, title: String(data.get("titulo") ?? "").trim() || undefined }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.error ?? "No se pudo guardar la sesión.");
        setSaving(false);
        return;
      }
      setOpen(false);
      setSaving(false);

      const personas = enrollments === 1 ? "1 persona recibirá sus recordatorios" : `${enrollments} personas recibirán sus recordatorios`;
      toast({
        tone: "success",
        title: "Sesión programada",
        detail: enrollments > 0 ? `${personas} según esta fecha.` : "Todavía no hay nadie inscrito en este curso.",
      });
      if (!streamUrl) {
        toast({
          tone: "warning",
          title: "El enlace de acceso todavía está pendiente",
          detail: "Puedes añadirlo más adelante. Los recordatorios que necesiten el enlace no se enviarán hasta que esté disponible.",
        });
      }
      router.refresh();
    } catch {
      setError("No se pudo conectar con el sistema.");
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className={`btn-sm ${variant === "ghost" ? "ghost" : ""}`} onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <div className="dialog is-wide" role="dialog" aria-modal="true" aria-labelledby="sesion-titulo">
        <h2 id="sesion-titulo">Programar sesión</h2>
        <p>
          {courseTitle}
          {enrollments > 0 ? ` · ${enrollments} inscrito${enrollments === 1 ? "" : "s"}` : ""}
        </p>

        <form ref={formRef} onSubmit={submit} className="session-form">
          <div className="session-form-row">
            <label>
              Fecha
              <input name="fecha" type="date" required />
            </label>
            <label>
              Hora
              <input name="hora" type="time" required defaultValue="19:00" />
            </label>
          </div>

          <div className="session-form-row">
            <label>
              Duración
              <select name="duracion" defaultValue="120">
                {DURACIONES.map((minutos) => (
                  <option key={minutos} value={minutos}>
                    {minutos < 60 ? `${minutos} min` : `${minutos / 60} hora${minutos === 60 ? "" : "s"}`}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Modalidad
              <input name="modalidad" defaultValue={modality ?? "Virtual"} readOnly title="Se toma del curso" />
            </label>
          </div>

          <label className="session-form-full">
            Nombre de la sesión <span className="field-optional">opcional</span>
            <input name="titulo" placeholder="Sesión única" autoComplete="off" />
          </label>

          <label className="session-form-full">
            Enlace de acceso <span className="field-optional">si ya lo tienes</span>
            <input name="enlace" type="url" placeholder="https://meet.google.com/…" autoComplete="off" />
            <small>
              Puede quedar vacío. Los avisos de 2 horas y 15 minutos antes esperarán a que lo agregues; el resto sale igual.
            </small>
          </label>

          {error ? <p className="form-error" role="alert">{error}</p> : null}

          <div className="dialog-actions">
            <button type="button" className="btn-sm ghost" onClick={() => setOpen(false)} disabled={saving}>Cancelar</button>
            <button type="submit" className="btn-sm" disabled={saving}>{saving ? "Guardando…" : "Programar sesión"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
