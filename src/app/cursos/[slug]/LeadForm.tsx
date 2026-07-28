"use client";

import { useRef, useState } from "react";

export function LeadForm({ courseSlug, courseTitle }: { courseSlug: string; courseTitle: string }) {
  const startedAt = useRef(Date.now());
  const idempotencyKey = useRef(
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    const form = event.currentTarget;
    const data = new FormData(form);
    const params = new URLSearchParams(window.location.search);
    const payload = {
      firstName: String(data.get("firstName") ?? ""),
      lastName: String(data.get("lastName") ?? ""),
      email: String(data.get("email") ?? ""),
      phone: String(data.get("phone") ?? ""),
      consent: data.get("consent") === "on",
      courseSlug,
      utmSource: params.get("utm_source") ?? undefined,
      utmMedium: params.get("utm_medium") ?? undefined,
      utmCampaign: params.get("utm_campaign") ?? undefined,
      landingUrl: window.location.href,
      referrer: document.referrer || undefined,
      website: String(data.get("website") ?? ""),
      formStartedAt: startedAt.current,
      idempotencyKey: idempotencyKey.current.replace(/-/g, "_"),
    };
    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? "No se pudo guardar el contacto.");
        setLoading(false);
        return;
      }
      if (typeof result.redirectUrl === "string" && result.redirectUrl.startsWith("https://")) {
        window.location.assign(result.redirectUrl);
        return;
      }
      setError("La información se guardó, pero el curso no tiene un destino configurado.");
    } catch {
      setError("No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.");
    }
    setLoading(false);
  }

  return (
    <form className="card lead-form" onSubmit={handleSubmit} noValidate>
      <span className="eyebrow">Registro de interés</span>
      <h2>Solicita información</h2>
      <p className="sub">Te contactaremos sobre “{courseTitle}”.</p>
      <div className="field-row">
        <div className="field">
          <label htmlFor="firstName">Nombres</label>
          <input id="firstName" name="firstName" autoComplete="given-name" required minLength={2} />
        </div>
        <div className="field">
          <label htmlFor="lastName">Apellidos</label>
          <input id="lastName" name="lastName" autoComplete="family-name" required minLength={2} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="email">Correo electrónico</label>
        <input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="field">
        <label htmlFor="phone">WhatsApp</label>
        <input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="0981234567" required aria-describedby="phone-help" />
        <small id="phone-help">Número de Ecuador con 10 dígitos o prefijo +593.</small>
      </div>
      <div className="honeypot" aria-hidden="true">
        <label htmlFor="website">Sitio web</label>
        <input id="website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <label className="checkbox">
        <input name="consent" type="checkbox" required />
        <span>Acepto el tratamiento de mis datos para recibir información del curso y seguimiento comercial.</span>
      </label>
      <button className="btn" type="submit" disabled={loading} aria-busy={loading}>
        {loading ? "Guardando…" : "Registrar mi interés"}
      </button>
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  );
}
