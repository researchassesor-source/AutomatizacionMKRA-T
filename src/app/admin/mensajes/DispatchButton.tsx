"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DispatchButton({ simulation }: { simulation: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function run() {
    setLoading(true);
    const response = await fetch("/api/admin/nurture/dispatch", { method: "POST" });
    const result = await response.json().catch(() => ({}));
    setMessage(response.ok ? `${result.processed ?? 0} mensaje(s) procesados.` : result.error ?? "No se pudieron procesar los mensajes.");
    setLoading(false);
    router.refresh();
  }
  return <div className="toolbar"><button type="button" className="btn-sm" onClick={run} disabled={loading}>{loading ? "Procesando…" : simulation ? "Simular mensajes pendientes" : "Enviar mensajes pendientes"}</button>{message && <span className="result-line" role="status">{message}</span>}</div>;
}
