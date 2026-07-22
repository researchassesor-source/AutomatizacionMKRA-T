"use client";

import { useState } from "react";

export function CompleteWidget({ courseSlug }: { courseSlug: string }) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ verifyUrl: string | null; emitido: boolean } | null>(
    null,
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/courses/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, courseSlug }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "No se pudo completar el curso.");
        setLoading(false);
        return;
      }
      setDone({ verifyUrl: json.verifyUrl ?? null, emitido: json.emitido === true });
      setLoading(false);
    } catch {
      setError("Error de conexion.");
      setLoading(false);
    }
  }

  if (done !== null) {
    return (
      <div className="card" style={{ marginTop: 24, textAlign: "center" }}>
        <div style={{ fontSize: "2.4rem" }}>🎉</div>
        <h2>¡Curso completado!</h2>
        <p className="sub">
          {done.emitido
            ? "Tu certificado ya fue emitido. Puedes verlo y verificarlo aqui."
            : "Registramos tu inscripcion. RA-Training emitira tu certificado y podras verificarlo en el siguiente enlace."}
        </p>
        {done.verifyUrl && (
          <a className="btn" href={done.verifyUrl} target="_blank" rel="noreferrer">
            {done.emitido ? "Ver / verificar mi certificado" : "Ver estado de mi certificado"}
          </a>
        )}
      </div>
    );
  }

  return (
    <form className="card" onSubmit={handleSubmit} style={{ marginTop: 24 }}>
      <h2>Finaliza y obten tu certificado</h2>
      <p className="sub">
        Confirma el correo con el que te inscribiste para emitir tu certificado.
      </p>
      <div className="field">
        <label htmlFor="email">Correo de inscripcion</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <button className="btn" type="submit" disabled={loading}>
        {loading ? "Emitiendo..." : "Completar curso y emitir certificado"}
      </button>
      {error && <p className="form-error">{error}</p>}
    </form>
  );
}
