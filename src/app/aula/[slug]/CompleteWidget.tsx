"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CompleteWidget({ courseSlug }: { courseSlug: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      router.push(`/certificado/${json.folio}`);
    } catch {
      setError("Error de conexion.");
      setLoading(false);
    }
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
