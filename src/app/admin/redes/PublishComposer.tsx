"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ecuadorLocalDateTimeToIso } from "@/lib/time";
import { useFeedback } from "../Feedback";

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
  const [imagen, setImagen] = useState("");
  const [cuando, setCuando] = useState("");
  const [seleccion, setSeleccion] = useState<string[]>(() => accounts.slice(0, 1).map((a) => a.id));
  const [repetir, setRepetir] = useState(false);
  const [guardando, setGuardando] = useState<string | null>(null);

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

  async function subir(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setGuardando("imagen");
    try {
      const token = await fetch("/api/admin/upload/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type }),
      });
      const info = await token.json().catch(() => ({}));
      if (!token.ok || !info.uploadUrl) {
        toast({ tone: "error", title: "No se pudo preparar la subida", detail: info.error ?? "Inténtalo de nuevo." });
        setGuardando(null);
        return;
      }
      const subida = await fetch(info.uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!subida.ok) {
        toast({ tone: "error", title: "No se pudo subir la imagen" });
        setGuardando(null);
        return;
      }
      setImagen(info.publicUrl ?? "");
      toast({ tone: "success", title: "Imagen lista" });
    } catch {
      toast({ tone: "error", title: "No se pudo subir la imagen" });
    }
    setGuardando(null);
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
          </div>
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
