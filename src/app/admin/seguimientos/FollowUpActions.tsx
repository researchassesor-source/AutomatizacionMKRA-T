"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ecuadorLocalDateTimeToIso } from "@/lib/time";

export function FollowUpActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function update(next: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/followups/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!response.ok) throw new Error("No se pudo actualizar el seguimiento.");
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No se pudo actualizar el seguimiento.");
    } finally {
      setBusy(false);
    }
  }
  async function reschedule() {
    const localDate = window.prompt("Nueva fecha y hora en Ecuador (AAAA-MM-DDTHH:mm)");
    if (!localDate || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(localDate)) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/followups/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "PENDIENTE", dueAt: ecuadorLocalDateTimeToIso(localDate) }),
      });
      if (!response.ok) throw new Error("No se pudo reprogramar el seguimiento.");
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No se pudo reprogramar el seguimiento.");
    } finally {
      setBusy(false);
    }
  }
  if (status !== "PENDIENTE" && status !== "VENCIDO") return null;
  return <><div className="card-actions"><button type="button" className="btn-sm" disabled={busy} onClick={() => update("COMPLETADO")}>Completar</button><button type="button" className="btn-sm ghost" disabled={busy} onClick={reschedule}>Reprogramar</button><button type="button" className="btn-sm ghost" disabled={busy} onClick={() => update("CANCELADO")}>Cancelar</button></div>{error && <span className="field-error" role="alert">{error}</span>}</>;
}
