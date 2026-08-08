"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ecuadorLocalDateTimeToIso } from "@/lib/time";
import { useFeedback } from "../Feedback";

export type ComposerAccount = { id: string; platform: string; displayName: string };

type Plantilla = { id: string; nombre: string; texto: string; enlace: string; imagen: string };

/**
 * Las plantillas viven en el navegador a proposito: son borradores de trabajo
 * de quien escribe, no contenido del CRM, y no tiene sentido que ocupen la base
 * ni que se compartan entre personas sin pedirlo.
 */
const PLANTILLAS_KEY = "ra-crm:plantillas-publicacion";

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
  const [imagen, setImagen] = useState("");
  const [cuando, setCuando] = useState("");
  const [seleccion, setSeleccion] = useState<string[]>(() => accounts.slice(0, 1).map((a) => a.id));
  const [repetir, setRepetir] = useState(false);
  const [guardando, setGuardando] = useState<string | null>(null);
  const [plantillas, setPlantillas] = useState<Plantilla[]>([]);

  useEffect(() => {
    try {
      const crudo = window.localStorage.getItem(PLANTILLAS_KEY);
      if (crudo) setPlantillas(JSON.parse(crudo) as Plantilla[]);
    } catch {
      // Un navegador sin almacenamiento no debe romper el compositor.
    }
  }, []);

  function persistir(lista: Plantilla[]) {
    setPlantillas(lista);
    try {
      window.localStorage.setItem(PLANTILLAS_KEY, JSON.stringify(lista));
    } catch {
      toast({ tone: "warning", title: "No se pudo guardar la plantilla en este navegador" });
    }
  }

  function guardarPlantilla() {
    if (!texto.trim()) {
      toast({ tone: "warning", title: "Escribe el texto antes de guardarlo" });
      return;
    }
    // La primera linea del texto sirve de nombre: es lo que quien escribe
    // reconoce, y evita pedir un titulo mas solo para guardar.
    const nombre = texto.trim().split(String.fromCharCode(10))[0].slice(0, 44);
    persistir([{ id: String(Date.now()), nombre, texto, enlace, imagen }, ...plantillas].slice(0, 12));
    toast({ tone: "success", title: "Plantilla guardada", detail: "Aparecerá aquí la próxima vez que publiques." });
  }

  function usarPlantilla(plantilla: Plantilla) {
    setTexto(plantilla.texto);
    setEnlace(plantilla.enlace);
    setImagen(plantilla.imagen);
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

  function alternar(id: string) {
    setSeleccion((actual) => (actual.includes(id) ? actual.filter((x) => x !== id) : [...actual, id]));
  }

  /**
   * Sube la imagen y deja su URL publica lista para la publicacion.
   *
   * Va contra `/api/admin/upload`, que recibe el archivo por multipart, lo
   * normaliza a JPEG y devuelve la URL. Antes esto llamaba a
   * `/api/admin/upload/token` esperando `{ uploadUrl, publicUrl }`, pero esa
   * ruta implementa el protocolo de subida directa de Vercel Blob: espera un
   * cuerpo con `type: "blob.generate-client-token"` y responde con un
   * `clientToken`. Ni el cuerpo que se enviaba era el que esa ruta entiende,
   * ni la respuesta contenia los campos que se leian aqui, asi que la subida
   * no podia funcionar en ningun entorno. La ruta de token sigue en pie para
   * los videos, que es para lo que existe.
   */
  async function subir(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    // Permite volver a elegir el mismo archivo despues de un fallo: sin esto
    // el input no dispara `change` la segunda vez y parece que no responde.
    event.target.value = "";
    setGuardando("imagen");
    try {
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
      toast({ tone: "success", title: "Imagen lista", detail: "Se usará en todas las redes seleccionadas." });
    } catch {
      toast({ tone: "error", title: "No se pudo subir la imagen", detail: "Revisa tu conexión e inténtalo de nuevo." });
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

    setGuardando("publicar");
    const scheduledAt = programar ? ecuadorLocalDateTimeToIso(cuando) : null;
    const logradas: string[] = [];
    const fallidas: string[] = [];

    for (const account of elegidas) {
      const response = await fetch("/api/admin/social/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: account.id,
          caption: texto,
          linkUrl: enlace || undefined,
          mediaUrl: imagen || undefined,
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
      <section className="panel">
        <h2>Nueva publicación</h2>
        <p className="muted">Todavía no hay ninguna cuenta lista para publicar.</p>
      </section>
    );
  }

  return (
    <section className="panel composer">
      <h2>Nueva publicación</h2>

      <div className="composer-grid">
        <div className="composer-form">
          <fieldset className="composer-networks">
            <legend>Publicar en</legend>
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

          <label className="composer-field">
            Texto
            <textarea rows={6} value={texto} onChange={(event) => setTexto(event.target.value)} placeholder="Escribe la publicación…" />
            <small>{texto.length} caracteres</small>
          </label>

          <label className="composer-field">
            Enlace <span className="field-optional">opcional</span>
            <input type="url" value={enlace} onChange={(event) => setEnlace(event.target.value)} placeholder="https://…" />
          </label>

          <div className="composer-field">
            Imagen <span className="field-optional">opcional</span>
            <div className="composer-media">
              <label className="btn-sm ghost">
                {guardando === "imagen" ? "Subiendo…" : "Subir imagen"}
                <input type="file" accept="image/*" hidden onChange={subir} />
              </label>
              <input type="url" value={imagen} onChange={(event) => setImagen(event.target.value)} placeholder="o pega una URL" />
              {imagen ? <button type="button" className="btn-sm ghost" onClick={() => setImagen("")}>Quitar</button> : null}
            </div>
          </div>

          <label className="composer-field">
            Programar para <span className="field-optional">déjalo vacío para publicar ahora</span>
            <input type="datetime-local" value={cuando} onChange={(event) => setCuando(event.target.value)} />
          </label>

          {cuando ? (
            <label className="composer-repeat">
              <input type="checkbox" checked={repetir} onChange={(event) => setRepetir(event.target.checked)} />
              <span>Repetir cada semana a esta misma hora</span>
            </label>
          ) : null}

          <div className="composer-actions">
            <button type="button" className="btn-sm" disabled={guardando !== null} onClick={() => publicar(Boolean(cuando))}>
              {guardando === "publicar" ? "Guardando…" : cuando ? "Programar publicación" : "Crear publicación"}
            </button>
            <button type="button" className="btn-sm ghost" onClick={guardarPlantilla}>Guardar como plantilla</button>
          </div>

          {plantillas.length > 0 ? (
            <div className="composer-templates">
              <span>Plantillas guardadas</span>
              {plantillas.map((plantilla) => (
                <span className="composer-template" key={plantilla.id}>
                  <button type="button" onClick={() => usarPlantilla(plantilla)} title="Usar esta plantilla">{plantilla.nombre}</button>
                  <button type="button" className="composer-template-remove" aria-label={`Borrar ${plantilla.nombre}`} onClick={() => persistir(plantillas.filter((item) => item.id !== plantilla.id))}>×</button>
                </span>
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
            <p className="preview-text">{texto || <span className="muted">El texto aparecerá aquí…</span>}</p>
            {imagen ? (
              <div className="preview-media">
                {/* Imagen remota de Blob: se muestra tal cual para que la vista previa sea fiel. */}
                <Image src={imagen} alt="" width={520} height={300} unoptimized />
              </div>
            ) : null}
            {enlace ? <span className="preview-link">{enlace}</span> : null}
          </article>
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
