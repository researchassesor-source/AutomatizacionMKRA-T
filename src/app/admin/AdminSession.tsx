"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { SessionRole } from "@/lib/auth/session";
import { isTechnicalProfile } from "@/lib/auth/roles";
import { TechnicalDetailProvider } from "./TechnicalDetail";

/**
 * Sesion del panel, resuelta una sola vez.
 *
 * Antes cada pagina montaba su propia navegacion y cada navegacion pedia
 * /api/admin/me por su cuenta. Al vivir en el layout, la peticion ocurre una
 * vez por visita y el perfil queda disponible para cualquier componente que
 * necesite decidir que mostrar.
 */
export type AdminSessionValue = {
  role: SessionRole;
  name: string;
  legacy: boolean;
  /** ¿Tiene perfil técnico? Decide si aparece el selector de vista. */
  technical: boolean;
  /** false mientras no se sabe quien es: evita parpadeos de menu. */
  ready: boolean;
};

const AdminSessionContext = createContext<AdminSessionValue>({
  role: "LECTURA",
  name: "Usuario",
  legacy: false,
  technical: false,
  ready: false,
});

export function AdminSessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AdminSessionValue>({ role: "LECTURA", name: "Usuario", legacy: false, technical: false, ready: false });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/me", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data) setSession({ role: data.role, name: data.name, legacy: Boolean(data.legacy), technical: isTechnicalProfile(data.role), ready: true });
        else setSession((previous) => ({ ...previous, ready: true }));
      })
      .catch(() => {
        if (!cancelled) setSession((previous) => ({ ...previous, ready: true }));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AdminSessionContext.Provider value={session}>
      <TechnicalDetailProvider available={isTechnicalProfile(session.role)}>{children}</TechnicalDetailProvider>
    </AdminSessionContext.Provider>
  );
}

export function useAdminSession(): AdminSessionValue {
  return useContext(AdminSessionContext);
}
