"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { VIEW_COOKIE, type ViewMode } from "@/lib/auth/view-mode-shared";

/**
 * Selector de vista, solo para el perfil tecnico.
 *
 * Escribe la cookie y refresca: el servidor vuelve a renderizar con la vista
 * elegida, de modo que "Direccion" oculta la navegacion de sistema y los
 * paneles de diagnostico de verdad, no solo unas etiquetas. Los permisos no
 * cambian; lo que cambia es lo que se muestra.
 */
export function ViewSwitch({ current }: { current: ViewMode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function select(mode: ViewMode) {
    if (mode === current) return;
    // Un año: es una preferencia de trabajo, no una sesión. Se escribe con
    // document.cookie a propósito: el servidor debe leer la vista en el
    // siguiente render, y una preferencia guardada solo en memoria dejaría la
    // navegación y los paneles decidiéndose con valores distintos.
    // biome-ignore lint/suspicious/noDocumentCookie: el servidor debe recibir la vista.
    document.cookie = `${VIEW_COOKIE}=${mode}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    startTransition(() => router.refresh());
  }

  return (
    <div className="view-switch" role="group" aria-label="Vista del panel">
      <span className="view-switch-label">Vista</span>
      {(["direccion", "tecnica"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          className={current === mode ? "is-active" : ""}
          onClick={() => select(mode)}
          aria-pressed={current === mode}
          disabled={pending}
          title={mode === "direccion"
            ? "Ver el panel exactamente como lo ve Dirección"
            : "Mostrar integraciones, diagnóstico y detalles técnicos"}
        >
          {mode === "direccion" ? "Dirección" : "Técnica"}
        </button>
      ))}
    </div>
  );
}
