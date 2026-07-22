"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function VerificarBuscar() {
  const router = useRouter();
  const [folio, setFolio] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const clean = folio.trim().toUpperCase();
    if (clean) router.push(`/verificar/${encodeURIComponent(clean)}`);
  }

  return (
    <main className="verify-box">
      <div className="verify-card">
        <h1 style={{ marginTop: 0 }}>Verificar un certificado</h1>
        <p className="muted">
          Ingresa el folio del certificado para comprobar su autenticidad.
        </p>
        <form onSubmit={handleSubmit} style={{ marginTop: 20 }}>
          <div className="field">
            <input
              type="text"
              placeholder="RA-2026-XXXXXX"
              value={folio}
              onChange={(e) => setFolio(e.target.value)}
              style={{
                width: "100%",
                padding: "12px",
                border: "1px solid var(--border)",
                borderRadius: 10,
                fontSize: "1rem",
                textAlign: "center",
                letterSpacing: "0.06em",
              }}
              required
            />
          </div>
          <button className="btn" type="submit">
            Verificar
          </button>
        </form>
      </div>
    </main>
  );
}
