"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function MessageActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function action(value: "cancel" | "retry") {
    if (value === "cancel" && !window.confirm("¿Cancelar este mensaje programado?")) return;
    setBusy(true);
    await fetch(`/api/admin/messages/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: value }) });
    setBusy(false);
    router.refresh();
  }
  return <div className="card-actions">{["PROGRAMADO","FALLIDO"].includes(status) && <button type="button" className="btn-sm ghost" disabled={busy} onClick={() => action("cancel")}>Cancelar</button>}{["FALLIDO","SIMULADO"].includes(status) && <button type="button" className="btn-sm" disabled={busy} onClick={() => action("retry")}>Reintentar</button>}</div>;
}
