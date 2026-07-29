import type { ReactNode } from "react";
import { AdminIcon } from "./AdminIcon";

export function AdminFilterPanel({ children, label = "Filtros de búsqueda" }: { children: ReactNode; label?: string }) {
  return (
    <details className="filter-panel" open>
      <summary><span><AdminIcon name="search" size={16} /> {label}</span><span>Mostrar u ocultar</span></summary>
      {children}
    </details>
  );
}
