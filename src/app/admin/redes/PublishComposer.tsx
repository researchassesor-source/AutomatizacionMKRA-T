"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ecuadorLocalDateTimeToIso } from "@/lib/time";
import {
  AVISO_INSTAGRAM_SIN_ENLACE,
  componerCaption,
  CTA_INSTAGRAM_POR_DEFECTO,
  esUrlDestinoValida,
  requiereAvisoInstagram,
} from "@/lib/social/cta";
import type { Platform } from "@/lib/social/types";
import { isSupportedSocialVideo, MAX_SOCIAL_VIDEO_BYTES, type SocialMediaType } from "@/lib/social/media";
import {
  agregarPlantilla,
  aplicarPlantilla,
  crearPlantilla,
  eliminarPlantilla,
  leerPlantillas,
  PLANTILLAS_KEY,
  type PlantillaPublicacion,
  renombrarPlantilla,
  seleccionParaPlantilla,
} from "@/lib/social/plantillas";
import { useFeedback } from "../Feedback";
import { SocialCopyPreview } from "./SocialCopyPreview";

export type ComposerAccount = { id: string; platform: string; displayName: string };

const REDES = [
  { platform: "FACEBOOK", label: "Facebook" },
  { platform: "INSTAGRAM", label: "Instagram" },
  { platform: "TIKTOK", label: "TikTok" },
] as const;

/**
 * Compositor de publicaciones.
 *
 * Se escribe una vez y se elige a que redes va. Antes habia un formulario por
 * cuenta y habia que repetir el mismo texto en cada una; ahora el texto es uno
 * y las casillas deciden donde sale.
 *
 * La vista previa importa mas de lo que parece: una publicacion mal cortada o
 * sin imagen no se puede arreglar despues sin borrarla de la red.
 */
export function PublishComposer({ accounts }: { accounts: ComposerAccount[] }) {
  const router = useRouter();
  const { toast } = useFeedback();
  const [texto, setTexto] = useState("");
  const [enlace, setEnlace] = useState("");
  /**
   * CTA de Instagram, separado del texto base.
   *
   * Instagram no convierte las URL del caption en enlaces. Antes se pegaba la
   * misma URL en las dos redes y en Instagram quedaba como texto muerto: largo,
   * feo y sin destino. Aqui se sustituye por una llamada a la accion que si
   * lleva a alguna parte, el enlace de la biografia.
   */
  const [ctaInstagram, setCtaInstagram] = useState(CTA_INSTAGRAM_POR_DEFECTO);
  const [imagen, setImagen] = useState("");
  const [mediaType, setMediaType] = useState<SocialMediaType>("IMAGE");
  const [mediaFile, setMediaFile] = useState<{ name: string; size: number; duration: number | null } | null>(null);
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState("");
  const [cuando, setCuando] = useState("");
  const [seleccion, setSeleccion] = useState<string[]>(() => accounts.slice(0, 1).map((a) => a.id));
  const [repetir, setRepetir] = useState(false);
  const [guardando, setGuardando] = useState<string | null>(null);
  const [plantillas, setPlantillas] = useState<PlantillaPublicacion[]>([]);
  /** Para llevar el foco al compositor al aplicar una plantilla. */
  const textoRef = useRef<HTMLTextAreaElement>(null);
  const mediaPreviewRef = useRef("");

  useEffect(() => {
    setPlantillas(leerPlantillas(window.localStorage.getItem(PLANTILLAS_KEY)));
  }, []);

  useEffect(() => () => {
    if (mediaPreviewRef.current) URL.revokeObjectURL(mediaPreviewRef.current);
  }, []);

  function limpiarMedia() {
    if (mediaPreviewRef.current) URL.revokeObjectURL(mediaPreviewRef.current);
    mediaPreviewRef.current = "";
    setMediaPreviewUrl("");
    setMediaFile(null);
    setImagen("");
  }

  function elegirTipo(tipo: SocialMediaType) {
    if (tipo === mediaType || guardando !== null) return;
    limpiarMedia();
    setMediaType(tipo);
  }

  function persistir(lista: PlantillaPublicacion[]) {
    setPlantillas(lista);
    try {
      window.localStorage.setItem(PLANTILLAS_KEY, JSON.stringify(lista));
    } catch {
      toast({ tone: "warning", title: "No se pudo guardar la plantilla en este navegador" });
    }
  }

  /**
   * Guardar como plantilla. NUNCA crea una publicacion ni programa nada:
   * escribe en el almacenamiento del navegador y se acaba ahi.
   */
  function guardarPlantilla() {
    if (!texto.trim()) {
      toast({ tone: "warning", title: "Escribe el texto antes de guardarlo" });
      return;
    }
    const plantilla = crearPlantilla({
      texto,
      enlace,
      imagen,
      mediaType,
      ctaInstagram,
      // Se guardan las plataformas y no los identificadores de cuenta: si una
      // cuenta se vuelve a registrar cambia de id y la plantilla apuntaria a
      // algo inexistente.
      plataformas: plataformasElegidas,
    });
    persistir(agregarPlantilla(plantillas, plantilla));
    toast({
      tone: "success",
      title: "Plantilla guardada",
      detail: "Incluye redes, textos, enlace y multimedia. La fecha no se guarda.",
    });
  }

  /**
   * Cargar la plantilla en el compositor y llevar el foco alli.
   *
   * La programacion se vacia siempre: heredar la hora de una plantilla vieja
   * significaria programar algo para un momento ya pasado, o publicar a una
   * hora que nadie eligio.
   */
  function usarPlantilla(plantilla: PlantillaPublicacion) {
    const estado = aplicarPlantilla(plantilla);
    setTexto(estado.texto);
    setEnlace(estado.enlace);
    limpiarMedia();
    setImagen(estado.imagen);
    setMediaType(estado.mediaType);
    setCtaInstagram(estado.ctaInstagram);
    setSeleccion(seleccionParaPlantilla(plantilla, accounts, seleccion));
    setCuando("");
    setRepetir(false);
    textoRef.current?.focus();
    textoRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    toast({ tone: "success", title: `Plantilla «${plantilla.nombre}» cargada`, detail: "Revisa el contenido y elige cuándo publicar." });
  }

  function renombrar(plantilla: PlantillaPublicacion) {
    const nombre = window.prompt("Nuevo nombre de la plantilla", plantilla.nombre);
    if (nombre === null) return;
    if (!nombre.trim()) {
      toast({ tone: "warning", title: "El nombre no puede quedar vacío" });
      return;
    }
    persistir(renombrarPlantilla(plantillas, plantilla.id, nombre));
    toast({ tone: "success", title: "Plantilla renombrada" });
  }

  function eliminar(plantilla: PlantillaPublicacion) {
    if (!window.confirm(`¿Eliminar la plantilla «${plantilla.nombre}»? No afecta a ninguna publicación.`)) return;
    persistir(eliminarPlantilla(plantillas, plantilla.id));
    toast({ tone: "success", title: "Plantilla eliminada" });
  }

  const porRed = useMemo(() => {
    const mapa = new Map<string, ComposerAccount[]>();
    for (const account of accounts) {
      const lista = mapa.get(account.platform) ?? [];
      lista.push(account);
      mapa.set(account.platform, lista);
    }
    return mapa;
  }, [accounts]);

  const elegidas = accounts.filter((account) => seleccion.includes(account.id));
  const vistaPrevia = elegidas[0] ?? accounts[0] ?? null;

  const enlaceValido = !enlace.trim() || esUrlDestinoValida(enlace);
  const plataformasElegidas = [...new Set(elegidas.map((cuenta) => cuenta.platform))] as Platform[];
  const avisarInstagram = requiereAvisoInstagram(plataformasElegidas, enlace);

  /**
   * Una vista previa por red, con el texto EXACTO que se va a publicar.
   *
   * Se calcula con la misma funcion que usa el servidor al crear la
   * publicacion. Cuando el panel hacia su propio calculo, cualquier diferencia
   * solo se descubria mirando la red despues de publicar.
   */
  const previas = useMemo(
    () =>
      plataformasElegidas.map((plataforma) => ({
        plataforma,
        etiqueta: nombreRed(plataforma),
        caption: componerCaption({
          plataforma,
          textoBase: texto,
          urlDestino: enlaceValido ? enlace : null,
          ctaInstagram,
        }),
      })),
    [plataformasElegidas, texto, enlace, enlaceValido, ctaInstagram],
  );

  function alternar(id: string) {
    setSeleccion((actual) => (actual.includes(id) ? actual.filter((x) => x !== id) : [...actual, id]));
  }

  /** Imagen conserva su ruta multipart; video usa la subida directa a Blob. */
  async function subir(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    // Permite volver a elegir el mismo archivo despues de un fallo: sin esto
    // el input no dispara `change` la segunda vez y parece que no responde.
    event.target.value = "";
    if (mediaType === "VIDEO") {
      const invalid = isSupportedSocialVideo(file);
      if (invalid) {
        toast({ tone: "warning", title: "No se puede usar este video", detail: invalid });
        return;
      }
      limpiarMedia();
      const localUrl = URL.createObjectURL(file);
      mediaPreviewRef.current = localUrl;
      setMediaPreviewUrl(localUrl);
      setMediaFile({ name: file.name, size: file.size, duration: null });
      const metadataVideo = document.createElement("video");
      metadataVideo.preload = "metadata";
      metadataVideo.src = localUrl;
      metadataVideo.onloadedmetadata = () => {
        if (Number.isFinite(metadataVideo.duration)) {
          setMediaFile((current) => current ? { ...current, duration: metadataVideo.duration } : current);
        }
      };
    } else if (!file.type.startsWith("image/") || file.size <= 0) {
      toast({ tone: "warning", title: "No se puede usar esta imagen", detail: "Elige un archivo de imagen válido." });
      return;
    }

    setGuardando("media");
    try {
      if (mediaType === "VIDEO") {
        const { upload } = await import("@vercel/blob/client");
        const blob = await upload(`social/${Date.now()}-${file.name}`, file, {
          access: "public",
          handleUploadUrl: "/api/admin/upload/token",
        });
        setImagen(blob.url);
        toast({ tone: "success", title: "Video listo", detail: "Ya puedes previsualizarlo y programarlo." });
      } else {
        const form = new FormData();
        form.append("file", file);
        const response = await fetch("/api/admin/upload", { method: "POST", body: form });
        const resultado = await response.json().catch(() => ({}));
        if (!response.ok || !resultado.url) {
          toast({
            tone: "error",
            title: "No se pudo subir la imagen",
            detail: resultado.error ?? "Inténtalo de nuevo en un momento.",
          });
          return;
        }
        setImagen(resultado.url);
        setMediaFile({ name: file.name, size: file.size, duration: null });
        toast({ tone: "success", title: "Imagen lista", detail: "Se usará en todas las redes seleccionadas." });
      }
    } catch {
      setImagen("");
      toast({ tone: "error", title: `No se pudo subir el ${mediaType === "VIDEO" ? "video" : "archivo"}`, detail: "Revisa tu conexión e inténtalo de nuevo." });
    } finally {
      setGuardando(null);
    }
  }

  async function publicar(programar: boolean) {
    if (!texto.trim()) {
      toast({ tone: "warning", title: "Escribe el texto de la publicación" });
      return;
    }
    if (elegidas.length === 0) {
      toast({ tone: "warning", title: "Elige al menos una red" });
      return;
    }
    if (programar && !cuando) {
      toast({ tone: "warning", title: "Indica la fecha y la hora" });
      return;
    }
    if (!enlaceValido) {
      toast({
        tone: "warning",
        title: "Revisa la URL de destino",
        detail: "Debe empezar por https:// y apuntar a un dominio público.",
      });
      return;
    }
    if (guardando === "media") {
      toast({ tone: "warning", title: "Espera a que termine la carga" });
      return;
    }
    if (mediaType === "VIDEO" && !imagen) {
      toast({ tone: "warning", title: "Primero sube el video", detail: "La publicación necesita una URL pública antes de programarse." });
      return;
    }

    setGuardando("publicar");
    const scheduledAt = programar ? ecuadorLocalDateTimeToIso(cuando) : null;
    const logradas: string[] = [];
    const fallidas: string[] = [];

    for (const account of elegidas) {
      const response = await fetch("/api/admin/social/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Se envia el texto BASE y los ingredientes del CTA; el servidor compone
        // el caption final con la misma funcion que alimenta la vista previa.
        body: JSON.stringify({
          accountId: account.id,
          caption: texto,
          linkUrl: enlace || undefined,
          instagramCta: ctaInstagram || undefined,
          mediaUrl: imagen || undefined,
          mediaType: imagen ? mediaType : undefined,
          scheduledAt: scheduledAt ?? undefined,
        }),
      });
      if (response.ok) logradas.push(nombreRed(account.platform));
      else fallidas.push(nombreRed(account.platform));
    }

    if (repetir && scheduledAt) {
      for (const account of elegidas) {
        await fetch("/api/admin/social/schedules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountId: account.id,
            name: texto.slice(0, 40),
            caption: texto,
            linkUrl: enlace || undefined,
            mediaUrl: imagen || undefined,
            weekday: new Date(scheduledAt).getUTCDay(),
            localTime: cuando.slice(11, 16),
          }),
        }).catch(() => undefined);
      }
    }

    setGuardando(null);
    if (logradas.length > 0) {
      toast({
        tone: "success",
        title: programar ? "Publicación programada" : "Publicación creada",
        detail: `${logradas.join(" y ")}${programar ? ` · saldrá el ${cuando.replace("T", " a las ")}` : " · procesa la cola para enviarla"}.`,
      });
      setTexto("");
      setEnlace("");
      setImagen("");
      limpiarMedia();
      setMediaType("IMAGE");
      setCuando("");
      setRepetir(false);
    }
    if (fallidas.length > 0) {
      toast({ tone: "error", title: `No se pudo crear en ${fallidas.join(" y ")}`, detail: "Revisa el estado del canal." });
    }
    router.refresh();
  }

  if (accounts.length === 0) {
    return (
      <section className="panel composer-empty">
        <span className="section-kicker">Crear contenido</span>
        <h2>Nueva publicación</h2>
        <p className="muted">Todavía no hay canales listos para publicar. Revisa la configuración de las cuentas.</p>
      </section>
    );
  }

  return (
    <section className="panel composer">
      <div className="panel-head composer-heading">
        <div>
          <span className="section-kicker">Crear contenido</span>
          <h2>Nueva publicación</h2>
          <p className="muted">Elige los destinos, prepara el contenido y decide cuándo debe salir.</p>
        </div>
      </div>

      <div className="composer-grid">
        <div className="composer-form">
          <fieldset className="composer-networks">
            <legend><span className="composer-step-number" aria-hidden="true">1</span> Destinos</legend>
            {REDES.map((red) => {
              const cuentas = porRed.get(red.platform) ?? [];
              if (cuentas.length === 0) {
                return (
                  <span className="composer-network is-off" key={red.platform} title="Este canal todavía no está listo para publicar">
                    {red.label}
                  </span>
                );
              }
              return cuentas.map((account) => (
                <label className={`composer-network ${seleccion.includes(account.id) ? "is-on" : ""}`} key={account.id}>
                  <input type="checkbox" checked={seleccion.includes(account.id)} onChange={() => alternar(account.id)} />
                  <span>{red.label}</span>
                  {cuentas.length > 1 ? <small>{account.displayName}</small> : null}
                </label>
              ));
            })}
          </fieldset>

          <label className="composer-field composer-field-primary">
            <span className="composer-field-title"><span className="composer-step-number" aria-hidden="true">2</span> Contenido</span>
            <textarea ref={textoRef} rows={6} value={texto} onChange={(event) => setTexto(event.target.value)} placeholder="Escribe la publicación…" />
            <small>{texto.length} caracteres</small>
          </label>

          <div className="composer-field composer-media-field">
            <span className="composer-field-title"><span className="composer-step-number" aria-hidden="true">3</span> Imagen / Video <span className="field-optional">opcional</span></span>
            <fieldset className="composer-media-types">
              <legend>Tipo de contenido multimedia</legend>
              <button type="button" disabled={guardando !== null} className={mediaType === "IMAGE" ? "is-active" : ""} aria-pressed={mediaType === "IMAGE"} onClick={() => elegirTipo("IMAGE")}>Imagen</button>
              <button type="button" disabled={guardando !== null} className={mediaType === "VIDEO" ? "is-active" : ""} aria-pressed={mediaType === "VIDEO"} onClick={() => elegirTipo("VIDEO")}>Video</button>
            </fieldset>
            <div className="composer-media">
              <label className="btn-sm ghost">
                {guardando === "media" ? "Subiendo…" : imagen || mediaPreviewUrl ? "Reemplazar" : `Subir ${mediaType === "VIDEO" ? "video" : "imagen"}`}
                <input type="file" accept={mediaType === "VIDEO" ? "video/mp4,video/quicktime,video/webm" : "image/*"} hidden disabled={guardando !== null} onChange={subir} />
              </label>
              {mediaType === "IMAGE" ? <input aria-label="URL de la imagen" type="url" value={imagen} onChange={(event) => setImagen(event.target.value)} placeholder="o pega una URL" /> : null}
              {imagen || mediaPreviewUrl ? <button type="button" className="btn-sm ghost" disabled={guardando === "media"} onClick={limpiarMedia}>Quitar</button> : null}
            </div>
            {mediaType === "VIDEO" ? <small>Formatos: MP4, MOV o WebM · máximo {Math.round(MAX_SOCIAL_VIDEO_BYTES / 1024 / 1024)} MB.</small> : null}
            {mediaFile ? (
              <div className="composer-media-details" aria-live="polite">
                <strong>{mediaFile.name}</strong>
                <span>{formatBytes(mediaFile.size)}{mediaFile.duration ? ` · ${formatDuration(mediaFile.duration)}` : ""}</span>
                <span>{guardando === "media" ? "Subiendo al almacenamiento…" : imagen ? "Carga completada" : "Pendiente de carga"}</span>
              </div>
            ) : null}
          </div>

          <fieldset className="composer-cta">
            <legend><span className="composer-step-number" aria-hidden="true">4</span> Enlace y llamada a la acción</legend>

            <label className="composer-field">
              URL de destino <span className="field-optional">opcional</span>
              <input
                type="url"
                value={enlace}
                onChange={(event) => setEnlace(event.target.value)}
                placeholder="https://automatizacion-mkra-t2.vercel.app/cursos/…"
                aria-invalid={!enlaceValido}
              />
              {enlace.trim() && !enlaceValido ? (
                <small className="field-error">La URL debe empezar por https:// y apuntar a un dominio público.</small>
              ) : enlaceValido && enlace.trim() ? (
                <small>Destino: {enlace.trim()}</small>
              ) : null}
            </label>

            {avisarInstagram ? (
              <div className="composer-note">
                <p>{AVISO_INSTAGRAM_SIN_ENLACE}</p>
                <label className="composer-field">
                  Llamada a la acción para Instagram
                  <input
                    type="text"
                    value={ctaInstagram}
                    onChange={(event) => setCtaInstagram(event.target.value)}
                    placeholder={CTA_INSTAGRAM_POR_DEFECTO}
                    maxLength={300}
                  />
                  <small>
                    Se añade solo al copy de Instagram. Facebook conserva la URL. Déjalo vacío si no quieres añadir nada.
                  </small>
                </label>
              </div>
            ) : null}
          </fieldset>

          <label className="composer-field">
            <span className="composer-field-title"><span className="composer-step-number" aria-hidden="true">5</span> Momento de publicación</span>
            <input type="datetime-local" value={cuando} onChange={(event) => setCuando(event.target.value)} />
            <small>Déjalo vacío para publicar ahora.</small>
          </label>

          {cuando ? (
            <label className="composer-repeat">
              <input type="checkbox" checked={repetir} onChange={(event) => setRepetir(event.target.checked)} />
              <span>Repetir cada semana a esta misma hora</span>
            </label>
          ) : null}

          <div className="composer-actions">
            <button type="button" className="btn-sm composer-primary-action" disabled={guardando !== null || (mediaType === "VIDEO" && !imagen)} aria-busy={guardando === "publicar"} onClick={() => publicar(Boolean(cuando))}>
              {guardando === "publicar" ? "Guardando…" : cuando ? "Programar publicación" : "Crear publicación"}
            </button>
            <button type="button" className="btn-sm ghost" onClick={guardarPlantilla}>Guardar como plantilla</button>
          </div>

          {plantillas.length > 0 ? (
            <div className="composer-templates">
              <span className="composer-templates-title">Guardadas</span>
              {plantillas.map((plantilla) => (
                <div className="composer-template" key={plantilla.id}>
                  <div className="composer-template-info">
                    <strong>{plantilla.nombre}</strong>
                    <small>
                      {plantilla.plataformas.length > 0 ? plantilla.plataformas.map(nombreRed).join(" · ") : "Sin redes guardadas"}
                      {plantilla.imagen ? ` · con ${plantilla.mediaType === "VIDEO" ? "video" : "imagen"}` : ""}
                      {plantilla.enlace ? " · con enlace" : ""}
                    </small>
                  </div>
                  <div className="composer-template-actions">
                    <button type="button" className="btn-sm" onClick={() => usarPlantilla(plantilla)}>Utilizar plantilla</button>
                    <button type="button" className="btn-sm ghost" onClick={() => renombrar(plantilla)}>Renombrar</button>
                    <button type="button" className="btn-sm ghost" onClick={() => eliminar(plantilla)}>Eliminar</button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <aside className="composer-preview" aria-label="Vista previa">
          <span className="composer-preview-title">Vista previa</span>
          <article className="preview-card">
            <header>
              <span className="preview-avatar" aria-hidden="true">RA</span>
              <span>
                <strong>{vistaPrevia ? vistaPrevia.displayName : "R.A. Training"}</strong>
                <small>{cuando ? `Programado · ${cuando.replace("T", " ")}` : "Ahora"}</small>
              </span>
            </header>
            <p className="preview-text">{texto ? <SocialCopyPreview text={texto} /> : <span className="muted">El texto aparecerá aquí…</span>}</p>
            {imagen ? (
              <div className="preview-media">
                {mediaType === "VIDEO"
                  ? <video src={mediaPreviewUrl || imagen} controls muted preload="metadata" />
                  : <Image src={imagen} alt="" width={520} height={300} unoptimized />}
              </div>
            ) : mediaType === "VIDEO" && mediaPreviewUrl ? (
              <div className="preview-media"><video src={mediaPreviewUrl} controls muted preload="metadata" /></div>
            ) : null}
          </article>

          {/* Una previa por red: el copy final difiere entre Facebook e
              Instagram, y enseñar solo uno esconde justo la diferencia. */}
          {texto.trim() && previas.length > 0 ? (
            <div className="preview-por-red">
              {previas.map((previa) => (
                <article key={previa.plataforma} className="preview-variant">
                  <h4>{previa.etiqueta}</h4>
                  <p className="preview-text">{previa.caption}</p>
                  {previa.plataforma === "INSTAGRAM" && enlace.trim() ? (
                    <small className="muted">El enlace no es pulsable en Instagram; va en la biografía.</small>
                  ) : null}
                </article>
              ))}
            </div>
          ) : null}

          {elegidas.length > 1 ? (
            <p className="composer-note">Se creará una publicación por cada red seleccionada.</p>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

function nombreRed(platform: string): string {
  return platform === "INSTAGRAM" ? "Instagram" : platform === "FACEBOOK" ? "Facebook" : "TikTok";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}
