"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type ContactOption = {
  id: string;
  title?: string;
  name?: string;
};

export function NewContactForm({
  courses,
  users,
  className = "btn-sm",
}: {
  courses: ContactOption[];
  users: ContactOption[];
  className?: string;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openDialog() {
    setError(null);
    dialogRef.current?.showModal();
    window.requestAnimationFrame(() => nameRef.current?.focus());
  }

  function closeDialog() {
    if (busy) return;
    setError(null);
    dialogRef.current?.close();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = event.currentTarget;
    const data = new FormData(form);

    try {
      const response = await fetch("/api/admin/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: data.get("fullName"),
          phone: data.get("phone"),
          email: data.get("email"),
          courseId: data.get("courseId"),
          source: data.get("source"),
          assignedToId: data.get("assignedToId"),
          classification: data.get("classification"),
          consent: data.get("consent") === "on",
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.error ?? "No se pudo crear el contacto.");
        return;
      }
      form.reset();
      dialogRef.current?.close();
      router.refresh();
    } catch {
      setError("No se pudo conectar con el servidor. Inténtalo nuevamente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className={className} type="button" onClick={openDialog}>Nuevo contacto</button>
      <dialog
        ref={dialogRef}
        className="admin-dialog"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            closeDialog();
          }
        }}
        onCancel={(event) => {
          event.preventDefault();
          if (!busy) {
            setError(null);
            dialogRef.current?.close();
          }
        }}
      >
        <form className="admin-dialog-card" onSubmit={submit}>
          <header className="admin-dialog-header">
            <div>
              <span className="eyebrow">Gestión comercial</span>
              <h2 id={titleId}>Nuevo contacto</h2>
              <p id={descriptionId}>Registra una persona y, si corresponde, su curso de interés.</p>
            </div>
            <button className="admin-dialog-close" type="button" onClick={closeDialog} aria-label="Cerrar formulario">×</button>
          </header>

          <div className="admin-dialog-fields">
            <label className="field">
              <span>Nombre completo <strong aria-hidden="true">*</strong></span>
              <input ref={nameRef} name="fullName" autoComplete="name" maxLength={160} required />
            </label>
            <label className="field">
              <span>WhatsApp <strong aria-hidden="true">*</strong></span>
              <input name="phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={30} placeholder="0981234567" required />
            </label>
            <label className="field">
              <span>Correo electrónico <small>(opcional)</small></span>
              <input name="email" type="email" inputMode="email" autoComplete="email" maxLength={254} />
            </label>
            <label className="field">
              <span>Curso de interés <small>(opcional)</small></span>
              <select name="courseId" defaultValue="">
                <option value="">Sin curso</option>
                {courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Origen <small>(opcional)</small></span>
              <input name="source" maxLength={120} placeholder="Ej. referido, llamada o evento" />
            </label>
            <label className="field">
              <span>Responsable <small>(opcional)</small></span>
              <select name="assignedToId" defaultValue="">
                <option value="">Sin asignar</option>
                {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Clasificación del registro</span>
              <select name="classification" defaultValue="UNKNOWN" required>
                <option value="UNKNOWN">Por clasificar</option>
                <option value="REAL">Real</option>
                <option value="TEST">Prueba técnica</option>
                <option value="DEMO">Demostración</option>
              </select>
              <small>TEST y DEMO nunca ingresan a automatizaciones.</small>
            </label>
          </div>

          <label className="checkbox admin-dialog-consent">
            <input name="consent" type="checkbox" required />
            <span>Confirmo que la persona autorizó el tratamiento de sus datos para recibir información de cursos y seguimiento comercial.</span>
          </label>

          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <footer className="admin-dialog-actions">
            <button className="btn-sm ghost" type="button" onClick={closeDialog} disabled={busy}>Cancelar</button>
            <button type="submit" className="btn-sm" disabled={busy}>{busy ? "Creando…" : "Crear contacto"}</button>
          </footer>
        </form>
      </dialog>
    </>
  );
}
