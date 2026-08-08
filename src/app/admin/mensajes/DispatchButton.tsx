"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFeedback } from "../Feedback";

/**
 * Procesar la cola de mensajes vencidos.
 *
 * Estar desactivado no es un fallo: significa que ahora mismo no hay ningun
 * mensaje cuya hora haya llegado. Antes el boton decia "Enviar pendientes (0)"
 * y quedaba gris sin mas, lo que se lee como una averia. Ahora lo dice.
 */
export function DispatchButton({ simulation, pendingCount }: { simulation: boolean; pendingCount: number }) {
  const router = useRouter();
  const { toast, confirm } = useFeedback();
  const [loading, setLoading] = useState(false);

  async function run() {
    const ok = await confirm({
      title: simulation ? "Procesar como simulación" : "Enviar los mensajes vencidos",
      body: simulation
        ? `Se procesarán ${pendingCount} mensaje(s) solo como prueba. No se envía nada y ningún contacto recibe notificación.`
        : `Se enviarán ahora ${pendingCount} mensaje(s) cuya hora ya pasó. Los que todavía no vencen no se tocan.`,
      confirmLabel: simulation ? "Procesar prueba" : "Enviar ahora",
    });
    if (!ok) return;

    setLoading(true);
    const response = await fetch("/api/admin/nurture/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true }),
    });
    const result = await response.json().catch(() => ({}));
    setLoading(false);
    if (response.ok) {
      const procesados = result.processed ?? 0;
      toast({
        tone: "success",
        title: procesados === 0 ? "No había nada que procesar" : `${procesados} mensaje(s) procesados`,
        detail: simulation ? "Fue una prueba: nadie recibió nada." : undefined,
      });
    } else {
      toast({ tone: "error", title: "No se pudieron procesar los mensajes", detail: result.error ?? "Inténtalo de nuevo." });
    }
    router.refresh();
  }

  if (pendingCount === 0) {
    return (
      <span className="dispatch-idle" title="Los mensajes salen solos a su hora. Este botón solo hace falta para adelantar los que ya vencieron.">
        Nada pendiente por ahora
      </span>
    );
  }

  return (
    <button type="button" className="btn-sm" onClick={run} disabled={loading}>
      {loading ? "Procesando…" : simulation ? `Procesar prueba (${pendingCount})` : `Enviar ahora (${pendingCount})`}
    </button>
  );
}
