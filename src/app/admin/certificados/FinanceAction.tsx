"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function FinanceAction({ enrollmentId, label }: { enrollmentId: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function run() {
    if (!window.confirm("¿Preparar el envío de esta inscripción a Finance? El CRM no emitirá el certificado.")) return;
    setBusy(true);
    const response = await fetch(`/api/admin/enrollments/${enrollmentId}/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: true }) });
    const result = await response.json();
    setMessage(response.ok ? (result.simulated ? "Simulado" : "Enviado") : result.error);
    setBusy(false);
    router.refresh();
  }
  return <div><button type="button" className="btn-sm ghost" disabled={busy} onClick={run}>{busy ? "Procesando…" : label}</button>{message && <div className="muted">{message}</div>}</div>;
}
