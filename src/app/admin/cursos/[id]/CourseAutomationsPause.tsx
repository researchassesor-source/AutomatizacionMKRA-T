"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFeedback } from "../../Feedback";

/**
 * Pausa de las automatizaciones de este curso.
 *
 * Antes, la unica forma de callar un curso era despublicarlo, y eso ademas lo
 * retira de la web publica: una decision operativa acababa teniendo
 * consecuencias comerciales. Esto detiene solo sus envios, y solo los de este
 * curso.
 */
export function CourseAutomationsPause({
  courseId,
  pausedAt,
  pausedBy,
  canEdit,
}: {
  courseId: string;
  pausedAt: string | null;
  pausedBy: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { toast, confirm } = useFeedback();
  const [busy, setBusy] = useState(false);
  const pausado = Boolean(pausedAt);

  async function alternar() {
    if (busy || !canEdit) return;
    const ok = await confirm({
      title: pausado ? "Reanudar las comunicaciones" : "Pausar las comunicaciones",
      body: pausado
        ? "Volverán a programarse y enviarse los avisos de este curso. Lo ya enviado no se repite."
        : "Este curso dejará de programar y enviar avisos. No se borra nada: las reglas, el historial y los mensajes ya enviados quedan intactos, y los demás cursos siguen funcionando.",
      confirmLabel: pausado ? "Reanudar" : "Pausar",
    });
    if (!ok) return;

    setBusy(true);
    try {
      const respuesta = await fetch(`/api/admin/courses/${courseId}/automations-pause`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: !pausado, confirm: true }),
      });
      const resultado = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) {
        toast({ tone: "error", title: "No se pudo cambiar el estado", detail: resultado.error ?? "Inténtalo de nuevo." });
        return;
      }
      toast({ tone: "success", title: pausado ? "Comunicaciones reanudadas" : "Comunicaciones pausadas" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`summary-line ${pausado ? "is-attention" : ""}`}>
      <span>
        <strong>Comunicaciones automáticas: {pausado ? "en pausa" : "activas"}.</strong>{" "}
        {pausado
          ? `Este curso no programa ni envía avisos${pausedBy ? ` (pausado por ${pausedBy})` : ""}. Los demás cursos no se ven afectados.`
          : "Los avisos de este curso se programan y envían con normalidad."}
      </span>
      {canEdit ? (
        <span className="summary-actions">
          <button type="button" className="btn-sm ghost" disabled={busy} onClick={alternar}>
            {busy ? "Guardando…" : pausado ? "Reanudar comunicaciones" : "Pausar comunicaciones"}
          </button>
        </span>
      ) : null}
    </section>
  );
}
