"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function LeadForm({ courseSlug }: { courseSlug: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const form = e.currentTarget;
    const data = new FormData(form);
    const params = new URLSearchParams(window.location.search);

    const payload = {
      fullName: String(data.get("fullName") ?? ""),
      email: String(data.get("email") ?? ""),
      phone: String(data.get("phone") ?? ""),
      consent: data.get("consent") === "on",
      courseSlug,
      utmSource: params.get("utm_source") ?? undefined,
      utmMedium: params.get("utm_medium") ?? undefined,
      utmCampaign: params.get("utm_campaign") ?? undefined,
    };

    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Ocurrio un error. Intenta de nuevo.");
        setLoading(false);
        return;
      }
      router.push(`/gracias?curso=${courseSlug}`);
    } catch {
      setError("No pudimos conectar. Revisa tu conexion.");
      setLoading(false);
    }
  }

  return (
    <form className="card" onSubmit={handleSubmit}>
      <h2>Inscribete gratis</h2>
      <p className="sub">Completa tus datos y accede al curso al instante.</p>

      <div className="field">
        <label htmlFor="fullName">Nombre completo</label>
        <input id="fullName" name="fullName" type="text" required />
      </div>
      <div className="field">
        <label htmlFor="email">Correo electronico</label>
        <input id="email" name="email" type="email" required />
      </div>
      <div className="field">
        <label htmlFor="phone">WhatsApp (opcional)</label>
        <input id="phone" name="phone" type="tel" />
      </div>

      <div className="field">
        <label className="checkbox">
          <input name="consent" type="checkbox" required />
          <span>
            Acepto recibir informacion de RA-Training y el tratamiento de mis
            datos personales.
          </span>
        </label>
      </div>

      <button className="btn" type="submit" disabled={loading}>
        {loading ? "Enviando..." : "Quiero mi cupo gratis"}
      </button>

      {error && <p className="form-error">{error}</p>}
    </form>
  );
}
