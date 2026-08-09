"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { SessionRole } from "@/lib/auth/session";
import { isTechnicalProfile } from "@/lib/auth/roles";
import { TechnicalDetailProvider } from "./TechnicalDetail";

/**
 * Sesion compartida del panel.
 *
 * Se vuelve a consultar en cada navegacion administrativa para reflejar un
 * cambio de cuenta sin conservar la identidad visual de la sesion anterior.
 */
export type AdminSessionValue = {
  role: SessionRole;
  name: string;
  email: string;
  legacy: boolean;
  /** ¿Tiene perfil técnico? Decide si aparece el selector de vista. */
  technical: boolean;
  /** false mientras no se sabe quien es: evita parpadeos de menu. */
  ready: boolean;
};

const AdminSessionContext = createContext<AdminSessionValue>({
  role: "LECTURA",
  name: "Usuario",
  email: "",
  legacy: false,
  technical: false,
  ready: false,
});

const emptySession: AdminSessionValue = {
  role: "LECTURA",
  name: "Usuario",
  email: "",
  legacy: false,
  technical: false,
  ready: false,
};

export function AdminSessionProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [session, setSession] = useState<AdminSessionValue>(emptySession);

  useEffect(() => {
    void pathname;
    let cancelled = false;
    fetch("/api/admin/me", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data) setSession({ role: data.role, name: data.name, email: data.email ?? "", legacy: Boolean(data.legacy), technical: isTechnicalProfile(data.role), ready: true });
        else setSession({ ...emptySession, ready: true });
      })
      .catch(() => {
        if (!cancelled) setSession((previous) => ({ ...previous, ready: true }));
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  return (
    <AdminSessionContext.Provider value={session}>
      <TechnicalDetailProvider available={isTechnicalProfile(session.role)}>{children}</TechnicalDetailProvider>
    </AdminSessionContext.Provider>
  );
}

export function useAdminSession(): AdminSessionValue {
  return useContext(AdminSessionContext);
}
