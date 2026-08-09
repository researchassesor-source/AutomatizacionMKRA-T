"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AdminActionMenu } from "../AdminActionMenu";

export function MessageActions({ id, status, onView }: { id: string; status: string; onView: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function action(value: "cancel" | "retry") {
    if (!window.confirm(value === "cancel" ? "¿Cancelar este mensaje programado?" : "¿Reintentar este mensaje ahora? En Preview seguirá siendo una simulación.")) return;
    setBusy(true);
    await fetch(`/api/admin/messages/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: value, confirm: true }) });
    setBusy(false);
    router.refresh();
  }

  return (
    <AdminActionMenu label="Acciones de la comunicación">
      <button type="button" onClick={onView}>Ver detalle</button>
      {["PROGRAMADO", "FALLIDO"].includes(status) ? <button type="button" disabled={busy} onClick={() => action("cancel")}>Cancelar</button> : null}
      {["FALLIDO", "SIMULADO"].includes(status) ? <button type="button" disabled={busy} onClick={() => action("retry")}>Reintentar</button> : null}
    </AdminActionMenu>
  );
}
