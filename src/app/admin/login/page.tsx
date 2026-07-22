"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "No se pudo iniciar sesion");
        setLoading(false);
        return;
      }
      router.push("/admin");
      router.refresh();
    } catch {
      setError("Error de conexion");
      setLoading(false);
    }
  }

  return (
    <main className="container">
      <div className="center-narrow" style={{ maxWidth: 380 }}>
        <form className="card" onSubmit={handleSubmit}>
          <h2>Panel RA-Training</h2>
          <p className="sub">Ingresa la contrasena de administrador.</p>
          <div className="field">
            <label htmlFor="pw">Contrasena</label>
            <input
              id="pw"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button className="btn" type="submit" disabled={loading}>
            {loading ? "Entrando..." : "Entrar"}
          </button>
          {error && <p className="form-error">{error}</p>}
        </form>
      </div>
    </main>
  );
}
