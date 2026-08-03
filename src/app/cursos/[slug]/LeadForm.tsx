"use client";

import { useEffect, useRef, useState } from "react";
import type { CourseCaptureMapping } from "@/data/course-capture-mapping";
import { captureLeadAttribution } from "@/lib/lead-attribution";
import { publicLeadFieldsSchema } from "@/lib/lead-validation";

const PRIVACY_POLICY_URL = process.env.NEXT_PUBLIC_PRIVACY_POLICY_URL?.trim() || null;
type FieldName = "firstName" | "lastName" | "email" | "phone" | "consent";
type CourseDetails = Pick<
  CourseCaptureMapping,
  "title" | "duration" | "modality" | "startDate" | "endDate" | "schedule" | "trainer"
>;

function createClientKey() {
  return (typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  ).replace(/-/g, "_");
}

export function LeadForm({
  courseSlug,
  course,
}: {
  courseSlug: string;
  course: CourseDetails;
}) {
  const startedAt = useRef(Date.now());
  const idempotencyKey = useRef(createClientKey());
  const activityKey = useRef(createClientKey());
  const startedTracked = useRef(false);
  const submitting = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});

  function currentAttribution() {
    return captureLeadAttribution(window.location.search, window.location.href, document.referrer);
  }

  function sendActivity(eventType: "FORM_VIEWED" | "FORM_STARTED") {
    void fetch("/api/leads/activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        eventType,
        courseSlug,
        activityKey: `${activityKey.current}_${eventType === "FORM_VIEWED" ? "view" : "start"}`,
        ...currentAttribution(),
      }),
    }).catch(() => undefined);
  }

  useEffect(() => {
    void fetch("/api/leads/activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        eventType: "FORM_VIEWED",
        courseSlug,
        activityKey: `${activityKey.current}_view`,
        ...captureLeadAttribution(window.location.search, window.location.href, document.referrer),
      }),
    }).catch(() => undefined);
  }, [courseSlug]);

  function handleInteraction(event: React.FormEvent<HTMLFormElement>) {
    const target = event.target as HTMLInputElement;
    if (target.name === "website" || startedTracked.current) return;
    startedTracked.current = true;
    sendActivity("FORM_STARTED");
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    setError(null);
    setFieldErrors({});
    const form = event.currentTarget;
    const data = new FormData(form);
    const parsed = publicLeadFieldsSchema.safeParse({
      firstName: String(data.get("firstName") ?? ""),
      lastName: String(data.get("lastName") ?? ""),
      email: String(data.get("email") ?? ""),
      phone: String(data.get("phone") ?? ""),
      consent: data.get("consent") === "on",
    });
    if (!parsed.success) {
      const nextErrors: Partial<Record<FieldName, string>> = {};
      for (const issue of parsed.error.errors) {
        const field = issue.path[0] as FieldName | undefined;
        if (field && !nextErrors[field]) nextErrors[field] = issue.message;
      }
      setFieldErrors(nextErrors);
      setError("Revisa los campos indicados antes de continuar.");
      const firstField = parsed.error.errors[0]?.path[0];
      if (typeof firstField === "string") {
        const control = form.elements.namedItem(firstField);
        if (control instanceof HTMLElement) control.focus();
      }
      return;
    }

    submitting.current = true;
    setLoading(true);
    const payload = {
      ...parsed.data,
      courseSlug,
      ...currentAttribution(),
      website: String(data.get("website") ?? ""),
      formStartedAt: startedAt.current,
      idempotencyKey: idempotencyKey.current,
    };
    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.error ?? "No pudimos completar el registro. Inténtalo nuevamente.");
        return;
      }
      const fallback = `/gracias?curso=${encodeURIComponent(courseSlug)}${result.duplicate ? "&actualizado=1" : ""}`;
      const destination = typeof result.redirectUrl === "string" && result.redirectUrl.startsWith("/gracias?")
        ? result.redirectUrl
        : fallback;
      window.location.assign(destination);
    } catch {
      setError("No se pudo conectar con el servidor. Revisa tu conexión e inténtalo nuevamente.");
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }

  const facts = [
    course.duration,
    course.modality,
    course.startDate && course.endDate ? `${course.startDate} – ${course.endDate}` : course.startDate,
    course.schedule,
    course.trainer ? `Capacitador: ${course.trainer}` : null,
  ].filter((item): item is string => Boolean(item));

  return (
    <form className="card lead-form" onSubmit={handleSubmit} onChange={handleInteraction} noValidate>
      <span className="eyebrow">Registro de interés</span>
      <h2>Reserva tu cupo gratis</h2>
      <p className="sub">Completa tus datos y nuestro equipo se pondrá en contacto contigo para confirmar tu participación.</p>
      <p className="lead-form-course"><strong>{course.title}</strong></p>
      {facts.length > 0 ? <ul className="lead-form-facts">{facts.map((fact) => <li key={fact}>{fact}</li>)}</ul> : null}

      <div className="field-row">
        <div className="field">
          <label htmlFor="firstName">Nombre <strong aria-hidden="true">*</strong></label>
          <input
            id="firstName"
            name="firstName"
            autoComplete="given-name"
            minLength={2}
            maxLength={80}
            required
            aria-invalid={Boolean(fieldErrors.firstName)}
            aria-describedby={fieldErrors.firstName ? "firstName-error" : undefined}
          />
          {fieldErrors.firstName ? <small className="field-error" id="firstName-error">{fieldErrors.firstName}</small> : null}
        </div>
        <div className="field">
          <label htmlFor="lastName">Apellidos <strong aria-hidden="true">*</strong></label>
          <input
            id="lastName"
            name="lastName"
            autoComplete="family-name"
            minLength={2}
            maxLength={80}
            required
            aria-invalid={Boolean(fieldErrors.lastName)}
            aria-describedby={fieldErrors.lastName ? "lastName-error" : undefined}
          />
          {fieldErrors.lastName ? <small className="field-error" id="lastName-error">{fieldErrors.lastName}</small> : null}
        </div>
      </div>
      <div className="field">
        <label htmlFor="email">Correo electrónico <strong aria-hidden="true">*</strong></label>
        <input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          maxLength={254}
          required
          placeholder="nombre@correo.com"
          aria-invalid={Boolean(fieldErrors.email)}
          aria-describedby={fieldErrors.email ? "email-error" : undefined}
        />
        {fieldErrors.email ? <small className="field-error" id="email-error">{fieldErrors.email}</small> : null}
      </div>
      <div className="field">
        <label htmlFor="phone">WhatsApp <strong aria-hidden="true">*</strong></label>
        <input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          maxLength={30}
          placeholder="0981234567"
          required
          aria-invalid={Boolean(fieldErrors.phone)}
          aria-describedby={`phone-help${fieldErrors.phone ? " phone-error" : ""}`}
        />
        <small id="phone-help">Número de Ecuador con 10 dígitos o prefijo +593.</small>
        {fieldErrors.phone ? <small className="field-error" id="phone-error">{fieldErrors.phone}</small> : null}
      </div>
      <div className="honeypot" aria-hidden="true">
        <label htmlFor="website">Sitio web</label>
        <input id="website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <label className={`checkbox lead-consent${fieldErrors.consent ? " has-error" : ""}`}>
        <input
          name="consent"
          type="checkbox"
          required
          aria-invalid={Boolean(fieldErrors.consent)}
          aria-describedby={fieldErrors.consent ? "consent-error" : undefined}
        />
        <span>
          Autorizo a R.A. Training a utilizar mis datos para gestionar mi inscripción y contactarme sobre este curso.
          {PRIVACY_POLICY_URL ? <> <a href={PRIVACY_POLICY_URL} target="_blank" rel="noopener noreferrer">Política de privacidad</a>.</> : null}
        </span>
      </label>
      {fieldErrors.consent ? <p className="field-error" id="consent-error">{fieldErrors.consent}</p> : null}
      <button className="btn" type="submit" disabled={loading} aria-busy={loading}>
        {loading ? "Enviando registro…" : "Quiero mi cupo gratis"}
      </button>
      <div className="form-status" aria-live="polite" aria-atomic="true">
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </div>
    </form>
  );
}
