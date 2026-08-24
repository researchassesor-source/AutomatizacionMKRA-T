"use client";

import { useEffect, useRef, useState } from "react";

type Attachment = Record<string, unknown> | null;

/** Los 5 tipos que el proxy del Bloque 2 sabe servir. */
const TIPOS_RENDERIZABLES = new Set(["image", "audio", "video", "document", "sticker"]);

const FALLBACK: Record<string, string> = {
  image: "No se pudo cargar esta imagen.",
  sticker: "No se pudo cargar este sticker.",
  audio: "Audio no disponible.",
  video: "Video no disponible.",
};

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor ? valor : null;
}

/** ¿Hay algo real que renderizar en vez de la etiqueta genérica ("Imagen", "Audio"...)? */
export function tieneMediaRenderizable(direction: string, type: string, attachment: Attachment): boolean {
  return direction === "INBOUND" && TIPOS_RENDERIZABLES.has(type) && texto(attachment?.mediaUrl) !== null;
}

/**
 * Multimedia entrante dentro de una burbuja del Inbox.
 *
 * Presentacional puro: solo entra el tipo y los metadatos ya resueltos por el
 * backend (Bloque 2), solo sale la marca de multimedia correspondiente. El
 * unico origen de archivo es `attachment.mediaUrl` -la ruta propia del proxy
 * autenticado-, nunca un id ni una URL de Meta: este componente no sabe nada
 * de Graph API ni de tokens.
 *
 * El caption ya lo pinta WhatsAppInbox.tsx como `m.text` (el backend pone el
 * mismo caption ahi): este componente nunca repite ese texto, para no
 * duplicar "Imagen" + la imagen + el mismo pie dos veces.
 */
export function WhatsAppMediaMessage({ type, attachment }: { type: string; attachment: Attachment }) {
  const mediaUrl = texto(attachment?.mediaUrl);
  const [error, setError] = useState(false);
  const [ampliada, setAmpliada] = useState(false);

  if (!mediaUrl) return null;
  if (error) return <p className="bubble-media-error muted">{FALLBACK[type] ?? "Archivo no disponible."}</p>;

  if (type === "image" || type === "sticker") {
    return (
      <>
        <button
          type="button"
          className={type === "sticker" ? "bubble-sticker" : "bubble-image"}
          onClick={() => setAmpliada(true)}
        >
          {/* biome-ignore lint/a11y/useAltText: alt vacio a proposito: el texto real ya vive en m.text/bubble-kind, no hay descripcion propia de Meta que repetir. */}
          <img src={mediaUrl} alt="" loading="lazy" onError={() => setError(true)} />
        </button>
        {ampliada ? <VisorImagen src={mediaUrl} onClose={() => setAmpliada(false)} /> : null}
      </>
    );
  }

  if (type === "audio") {
    return (
      // biome-ignore lint/a11y/useMediaCaption: audio entrante de WhatsApp, sin pista de texto que ofrecer.
      <audio className="bubble-audio" controls preload="metadata" src={mediaUrl} onError={() => setError(true)}>
        Tu navegador no puede reproducir este audio.
      </audio>
    );
  }

  if (type === "video") {
    return (
      // biome-ignore lint/a11y/useMediaCaption: video entrante de WhatsApp, sin pista de texto que ofrecer.
      <video className="bubble-video" controls preload="metadata" playsInline src={mediaUrl} onError={() => setError(true)}>
        Tu navegador no puede reproducir este video.
      </video>
    );
  }

  if (type === "document") {
    const nombre = texto(attachment?.filename) ?? "Documento";
    const mime = texto(attachment?.mime_type);
    return (
      <a className="bubble-document" href={mediaUrl} target="_blank" rel="noopener noreferrer">
        <span className="bubble-document-icon" aria-hidden="true">📄</span>
        <span className="bubble-document-body">
          <strong>{nombre}</strong>
          {mime ? <span className="muted">{mime}</span> : null}
        </span>
        <span className="bubble-document-action">Abrir</span>
      </a>
    );
  }

  return null;
}

/**
 * Ampliar una imagen o sticker.
 *
 * Mismo patron ya usado por ContactoSinVincular: <dialog> nativo, sin
 * libreria externa. Se cierra con el boton X o con Escape -igual que el
 * modal de vincular contacto-, sin agregar cierre al clic afuera porque ese
 * modal existente tampoco lo hace.
 */
function VisorImagen({ src, onClose }: { src: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="media-viewer"
      aria-label="Imagen ampliada"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <button type="button" className="media-viewer-close" onClick={onClose} aria-label="Cerrar imagen ampliada">×</button>
      {/* biome-ignore lint/a11y/useAltText: misma imagen que en la burbuja, ya sin descripcion propia que ofrecer. */}
      <img src={src} alt="" />
    </dialog>
  );
}
