"use client";

import { useState } from "react";

type TestResponse = { ok?: boolean; sent?: boolean; message?: string; error?: string };

/**
 * Prueba controlada del correo institucional.
 *
 * Sin destinatario solo comprueba credenciales. Con destinatario envía un único
 * mensaje a una dirección que la persona administradora controla: nunca es un
 * canal de envío masivo.
 */
export function EmailTestPanel() {
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function runTest(withRecipient: boolean) {
    const to = recipient.trim();
    if (withRecipient && !to) {
      setResult({ ok: false, text: "Indica una dirección de correo controlada para la prueba." });
      return;
    }
    if (withRecipient && !window.confirm(`¿Enviar un correo de prueba real a ${to}?`)) return;
    setBusy(true);
    try {
      const response = await fetch("/api/admin/email/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(withRecipient ? { confirm: true, to } : { confirm: true }),
      });
      const payload = (await response.json().catch(() => ({}))) as TestResponse;
      setResult({
        ok: response.ok && payload.ok === true,
        text: response.ok && payload.ok
          ? payload.message ?? "Comprobación completada."
          : payload.error ?? "No se pudo completar la comprobación del correo.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>Comprobar el servidor de correo</h2>
      <p className="muted">
        Verifica que el CRM puede autenticarse con el correo institucional. La contraseña nunca se muestra ni llega al navegador.
      </p>
      <div className="form-row">
        <input
          type="email"
          value={recipient}
          onChange={(event) => setRecipient(event.target.value)}
          placeholder="Correo para la prueba (opcional)"
          aria-label="Correo de prueba"
        />
        <button type="button" className="btn-sm ghost" disabled={busy} onClick={() => runTest(false)}>
          Comprobar credenciales
        </button>
        <button type="button" className="btn-sm" disabled={busy} onClick={() => runTest(true)}>
          Enviar correo de prueba
        </button>
      </div>
      {result && <p className="result-line" role="status">{result.text}</p>}
    </section>
  );
}
