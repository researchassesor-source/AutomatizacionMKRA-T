"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFeedback } from "../Feedback";

export function ArchiveSocialPostButton({ postId, label = "Descartar aviso" }: { postId: string; label?: string }) {
  const router = useRouter();
  const { confirm, toast } = useFeedback();
  const [busy, setBusy] = useState(false);

  async function archiveLocally() {
    if (busy) return;
    const accepted = await confirm({
      title: "Descartar este aviso",
      body: "Este aviso se quitará del CRM. No se eliminará ninguna publicación de Facebook.",
      confirmLabel: "Descartar aviso",
      tone: "danger",
    });
    if (!accepted) return;

    setBusy(true);
    const response = await fetch(`/api/admin/social/posts/${postId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "archive", confirm: true }),
    });
    const result = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      toast({ tone: "error", title: "No se pudo quitar el aviso", detail: result.error ?? "Inténtalo de nuevo." });
      return;
    }
    toast({ tone: "success", title: "Aviso descartado" });
    router.refresh();
  }

  return <button type="button" className="btn-sm ghost" disabled={busy} onClick={archiveLocally}>{busy ? "Quitando…" : label}</button>;
}
