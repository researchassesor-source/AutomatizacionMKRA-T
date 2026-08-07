"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AdminIcon } from "./AdminIcon";

/**
 * Avisos y confirmaciones del panel.
 *
 * Sustituye a window.confirm(), que no se puede redactar, no explica las
 * consecuencias y bloquea la pestana entera. Aqui la confirmacion dice que va a
 * pasar y el aviso posterior dice que paso, en la misma frase que usaria una
 * persona.
 */
export type ToastTone = "success" | "warning" | "error" | "info";

export type Toast = {
  id: number;
  tone: ToastTone;
  title: string;
  detail?: string;
  /** Accion opcional: "Reintentar Instagram", "Agregar enlace". */
  action?: { label: string; onClick: () => void };
};

type ConfirmRequest = {
  title: string;
  body: string;
  confirmLabel: string;
  tone?: "danger" | "normal";
  /** Texto que hay que escribir para confirmar. Solo para lo irreversible. */
  typeToConfirm?: string;
};

type FeedbackValue = {
  toast: (toast: Omit<Toast, "id">) => void;
  confirm: (request: ConfirmRequest) => Promise<boolean>;
};

const FeedbackContext = createContext<FeedbackValue>({
  toast: () => undefined,
  confirm: async () => false,
});

const TOAST_MS = 6000;

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [request, setRequest] = useState<(ConfirmRequest & { resolve: (value: boolean) => void }) | null>(null);
  const [typed, setTyped] = useState("");
  const nextId = useRef(1);
  const dialogRef = useRef<HTMLDivElement>(null);

  const toast = useCallback((input: Omit<Toast, "id">) => {
    const id = nextId.current++;
    setToasts((current) => [...current, { ...input, id }]);
    // Un error se queda hasta que alguien lo cierra: es informacion que no
    // conviene perder por no estar mirando la pantalla.
    if (input.tone !== "error") {
      window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), TOAST_MS);
    }
  }, []);

  const confirm = useCallback((input: ConfirmRequest) => {
    setTyped("");
    return new Promise<boolean>((resolve) => setRequest({ ...input, resolve }));
  }, []);

  useEffect(() => {
    if (!request) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        request.resolve(false);
        setRequest(null);
      }
    };
    window.addEventListener("keydown", onKey);
    window.requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>("input, button")?.focus());
    return () => window.removeEventListener("keydown", onKey);
  }, [request]);

  const puedeConfirmar = !request?.typeToConfirm || typed.trim() === request.typeToConfirm;

  return (
    <FeedbackContext.Provider value={{ toast, confirm }}>
      {children}

      <section className="toast-stack" aria-label="Avisos" aria-live="polite">
        {toasts.map((item) => (
          <article className={`toast is-${item.tone}`} key={item.id}>
            <AdminIcon name={item.tone === "success" ? "secure" : item.tone === "error" ? "alert" : "activity"} size={17} />
            <div className="toast-copy">
              <strong>{item.title}</strong>
              {item.detail ? <small>{item.detail}</small> : null}
            </div>
            {item.action ? (
              <button type="button" className="toast-action" onClick={() => { item.action?.onClick(); setToasts((c) => c.filter((t) => t.id !== item.id)); }}>
                {item.action.label}
              </button>
            ) : null}
            <button type="button" className="toast-close" aria-label="Cerrar aviso" onClick={() => setToasts((c) => c.filter((t) => t.id !== item.id))}>
              <AdminIcon name="close" size={15} />
            </button>
          </article>
        ))}
      </section>

      {request ? (
        <div className="dialog-backdrop" role="presentation">
          <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dialog-title" ref={dialogRef}>
            <h2 id="dialog-title">{request.title}</h2>
            <p>{request.body}</p>
            {request.typeToConfirm ? (
              <label className="dialog-confirm-field">
                Para confirmar, escribe <strong>{request.typeToConfirm}</strong>
                <input value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" />
              </label>
            ) : null}
            <div className="dialog-actions">
              <button type="button" className="btn-sm ghost" onClick={() => { request.resolve(false); setRequest(null); }}>
                Cancelar
              </button>
              <button
                type="button"
                className={`btn-sm ${request.tone === "danger" ? "danger" : ""}`}
                disabled={!puedeConfirmar}
                onClick={() => { request.resolve(true); setRequest(null); }}
              >
                {request.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </FeedbackContext.Provider>
  );
}

export function useFeedback(): FeedbackValue {
  return useContext(FeedbackContext);
}
