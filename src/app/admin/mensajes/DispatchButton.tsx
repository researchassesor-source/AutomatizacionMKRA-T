"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DispatchButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/nurture/dispatch", { method: "POST" });
      const json = await res.json();
      setMsg(`Procesados: ${json.processed ?? 0} mensaje(s).`);
      router.refresh();
    } catch {
      setMsg("Error al procesar la cola.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button className="btn-sm" onClick={run} disabled={loading}>
        {loading ? "Procesando..." : "Procesar cola ahora"}
      </button>
      {msg && <span className="result-line" style={{ marginLeft: 10 }}>{msg}</span>}
    </div>
  );
}
