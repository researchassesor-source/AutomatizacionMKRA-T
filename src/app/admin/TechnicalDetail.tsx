"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

/**
 * Interruptor "Detalle tecnico".
 *
 * Existe para que una sola aplicacion sirva a dos personas distintas sin
 * mantener dos disenos. Apagado, el perfil tecnico ve exactamente lo mismo que
 * vera direccion, que es la unica forma fiable de comprobar que lo que se
 * entrega esta bien. Encendido, aparecen los codigos de error, los estados
 * internos y los identificadores de proveedor en su sitio.
 *
 * La preferencia vive en el navegador: es una forma de mirar, no un permiso.
 * Nunca amplia lo que se puede hacer, solo lo que se muestra.
 */
const STORAGE_KEY = "ra-crm:detalle-tecnico";

type TechnicalDetailValue = {
  /** ¿El usuario puede activar el detalle? Solo el perfil técnico. */
  available: boolean;
  enabled: boolean;
  toggle: () => void;
};

const TechnicalDetailContext = createContext<TechnicalDetailValue>({
  available: false,
  enabled: false,
  toggle: () => undefined,
});

export function TechnicalDetailProvider({ available, children }: { available: boolean; children: React.ReactNode }) {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (!available) {
      setEnabled(false);
      return;
    }
    try {
      setEnabled(window.localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      // Un navegador sin almacenamiento local no debe romper el panel.
    }
  }, [available]);

  const toggle = useCallback(() => {
    setEnabled((previous) => {
      const next = !previous;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Sin persistencia el interruptor sigue funcionando en esta sesión.
      }
      return next;
    });
  }, []);

  return (
    <TechnicalDetailContext.Provider value={{ available, enabled: available && enabled, toggle }}>
      {children}
    </TechnicalDetailContext.Provider>
  );
}

export function useTechnicalDetail(): TechnicalDetailValue {
  return useContext(TechnicalDetailContext);
}

/**
 * Envuelve informacion que solo tiene sentido para quien conoce el sistema:
 * codigos de error, identificadores de proveedor, estados internos.
 */
export function TechnicalOnly({ children }: { children: React.ReactNode }) {
  const { enabled } = useTechnicalDetail();
  if (!enabled) return null;
  return <span className="tech-detail">{children}</span>;
}
