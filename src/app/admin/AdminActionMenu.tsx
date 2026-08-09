"use client";

import type { ReactNode } from "react";
import { useRef } from "react";

type AdminActionMenuProps = {
  label?: string;
  children: ReactNode;
};

/** Menú nativo y accesible para acciones secundarias de una fila. */
export function AdminActionMenu({ label = "Más acciones", children }: AdminActionMenuProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  return (
    <details ref={detailsRef} className="admin-action-menu">
      <summary aria-label={label} title={label}>•••</summary>
      <fieldset className="admin-action-menu-popover" onClick={(event) => {
        if ((event.target as HTMLElement).closest("button, a")) detailsRef.current?.removeAttribute("open");
      }} onKeyUp={(event) => {
        if ((event.key === "Enter" || event.key === " ") && (event.target as HTMLElement).closest("button, a")) detailsRef.current?.removeAttribute("open");
      }}><legend className="sr-only">{label}</legend>{children}</fieldset>
    </details>
  );
}
