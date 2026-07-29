"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DispatchButton({ simulation, pendingCount }: { simulation: boolean; pendingCount: number }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function run() {
    const action = simulation ? "simular" : "enviar";
    if (!window.confirm(`¿Confirmas que deseas ${action} ${pendingCount} mensaje(s) pendiente(s)?`)) return;
    setLoading(true);
    const response = await fetch("/api/admin/nurture/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true }),
    });
    const result = await response.json().catch(() => ({}));
    setMessage(response.ok ? `${result.processed ?? 0} mensaje(s) procesados.` : result.error ?? "No se pudieron procesar los mensajes.");
    setLoading(false);
    router.refresh();
  }
  return <div className="toolbar"><button type="button" className="btn-sm" onClick={run} disabled={loading || pendingCount === 0}>{loading ? "Procesando…" : simulation ? `Simular pendientes (${pendingCount})` : `Enviar pendientes (${pendingCount})`}</button>{message && <span className="result-line" role="status">{message}</span>}</div>;
}
