"use client";

import Image from "next/image";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? "No se pudo iniciar sesión.");
        setLoading(false);
        return;
      }
      router.replace("/admin");
      router.refresh();
    } catch {
      setError("No se pudo conectar con el sistema.");
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <div className="login-shell">
        <section className="login-identity" aria-labelledby="crm-name">
          <div className="login-logo-wrap">
            <Image
              src="/crm-logo.png"
              alt="Icono oficial del CRM de R.A. Training"
              width={320}
              height={320}
              priority
            />
          </div>
          <span className="login-kicker">Gestión comercial</span>
          <h1 id="crm-name">R.A. Training CRM</h1>
          <p>Sistema de Gestión de Relaciones con Clientes</p>
        </section>

        <div className="login-divider" aria-hidden="true" />

        <section className="login-form-side" aria-labelledby="login-title">
          <form className="login-form" onSubmit={handleSubmit}>
            <header className="login-form-header">
              <span className="login-kicker">Acceso administrativo</span>
              <h2 id="login-title">Bienvenido</h2>
              <p>Ingresa a tu espacio de gestión comercial</p>
            </header>

            <div className="login-field">
              <label htmlFor="admin-email">Correo electrónico</label>
              <input
                id="admin-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                placeholder="nombre@ra-training.com"
                aria-describedby={error ? "login-error" : undefined}
              />
            </div>

            <div className="login-field">
              <label htmlFor="admin-password">Contraseña</label>
              <div className="login-password-field">
                <input
                  id="admin-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  placeholder="Ingresa tu contraseña"
                  required
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? "login-error" : undefined}
                />
                <button
                  className="password-toggle"
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                  aria-pressed={showPassword}
                >
                  {showPassword ? "Ocultar" : "Mostrar"}
                </button>
              </div>
            </div>

            <button className="login-submit" type="submit" disabled={loading} aria-busy={loading}>
              {loading ? "Verificando…" : "Ingresar al CRM"}
            </button>

            {error && (
              <p className="login-error" id="login-error" role="alert">
                {error}
              </p>
            )}

            <p className="login-authorized">Acceso exclusivo para personal autorizado</p>
          </form>
        </section>
      </div>
    </main>
  );
}
