"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { PLANTILLAS_DE_BANDEJA } from "@/lib/whatsapp/inbox-templates";
import { etiquetaDeEstado, etiquetaDeTipo, mensajeDeError } from "./mensajes-de-error";

type Ventana = { open: boolean; expiresAt: string | null; remainingSeconds: number; reason: string | null };
type Resumen = {
  id: string;
  name: string;
  phonePartial: string;
  linked: boolean;
  state: "AUTOMATION" | "HUMAN_HANDOFF" | "RESOLVED";
  assignedTo: { id: string; name: string } | null;
  lastInboundAt: string | null;
  unreadCount: number;
  lastMessage: { preview: string; at: string } | null;
  window: Ventana;
};
type Mensaje = {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  origin: "CONTACT" | "HUMAN" | "AUTOMATION";
  at: string;
  type: string;
  text: string | null;
  attachment: Record<string, unknown> | null;
  status: string | null;
  actor: string | null;
};
type Inscripcion = { id: string; status: string; course: { id: string; title: string } };
type Detalle = {
  conversation: {
    id: string;
    phone: string;
    state: Resumen["state"];
    assignedTo: { id: string; name: string } | null;
    linked: boolean;
    lead: { id: string; name: string; email: string | null; enrollments: Inscripcion[] } | null;
  };
  window: Ventana;
  messages: Mensaje[];
};

const FILTROS = [
  { key: "todas", label: "Todas" },
  { key: "no-leidas", label: "No leídas" },
  { key: "atencion", label: "En atención" },
  { key: "sin-vincular", label: "Sin vincular" },
  { key: "resueltas", label: "Resueltas" },
] as const;
type Filtro = (typeof FILTROS)[number]["key"];

/** Cada cuánto se recarga la lista mientras la pestaña está a la vista. */
const POLLING_MS = 12_000;

function hora(iso: string): string {
  return new Date(iso).toLocaleString("es-EC", { timeZone: "America/Guayaquil", dateStyle: "short", timeStyle: "short" });
}

function textoDeVentana(v: Ventana): string {
  if (!v.open) return v.reason === "SIN_MENSAJES" ? "Sin mensajes del contacto · usa plantilla" : "Ventana cerrada · usa plantilla";
  const horas = Math.floor(v.remainingSeconds / 3600);
  const minutos = Math.floor((v.remainingSeconds % 3600) / 60);
  return horas > 0 ? `Ventana abierta · ${horas} h ${minutos} min` : `Ventana abierta · ${minutos} min`;
}

const ESTADO_TEXTO: Record<Resumen["state"], string> = {
  AUTOMATION: "Automatización",
  HUMAN_HANDOFF: "Atención humana activa",
  RESOLVED: "Atención resuelta",
};

/**
 * Bandeja de WhatsApp.
 *
 * Tres paneles en escritorio; en pantallas pequenas se navega entre ellos, que
 * es lo unico legible en 375 px. Toda decision de envio la toma el servidor:
 * aqui se muestra la ventana de atencion y se ocultan las plantillas que no
 * proceden, pero el backend vuelve a comprobarlo.
 */
export function WhatsAppInbox() {
  const [conversaciones, setConversaciones] = useState<Resumen[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cargandoLista, setCargandoLista] = useState(true);
  const [errorLista, setErrorLista] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todas");

  const [seleccionada, setSeleccionada] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [errorDetalle, setErrorDetalle] = useState<string | null>(null);

  const [borrador, setBorrador] = useState("");
  const [modo, setModo] = useState<"text" | "template">("text");
  const [plantilla, setPlantilla] = useState<string>(PLANTILLAS_DE_BANDEJA[0]?.key ?? "");
  const [inscripcion, setInscripcion] = useState<string>("");
  const [citado, setCitado] = useState<{ id: string; preview: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: "error" | "ok"; texto: string } | null>(null);
  const [panelInfo, setPanelInfo] = useState(false);
  const [asesores, setAsesores] = useState<Array<{ id: string; name: string; role: string }>>([]);
  const [asignando, setAsignando] = useState(false);

  /**
   * Identidad del intento en curso.
   *
   * Se genera una vez por mensaje y NO se regenera al reintentar: si la
   * peticion se quedo sin respuesta clara, repetirla con una identidad nueva
   * mandaria un segundo WhatsApp a la misma persona.
   */
  const intento = useRef<string | null>(null);
  const chatRef = useRef<HTMLDivElement | null>(null);
  const pegadoAbajo = useRef(true);
  const leidas = useRef(new Set<string>());
  const abortRef = useRef<AbortController | null>(null);

  const cargarLista = useCallback(async (opciones: { cursor?: string | null; reemplazar?: boolean } = {}) => {
    const params = new URLSearchParams({ limit: "25" });
    if (busqueda.trim()) params.set("search", busqueda.trim());
    if (filtro === "atencion") params.set("state", "HUMAN_HANDOFF");
    if (filtro === "resueltas") params.set("state", "RESOLVED");
    if (opciones.cursor) params.set("cursor", opciones.cursor);
    try {
      const res = await fetch(`/api/admin/whatsapp/conversations?${params}`);
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setErrorLista(mensajeDeError(json.errorCode, json.error));
        return;
      }
      setErrorLista(null);
      setConversaciones((previas) => (opciones.reemplazar === false ? [...previas, ...json.conversations] : json.conversations));
      setCursor(json.nextCursor ?? null);
    } catch {
      setErrorLista("No se pudo cargar la bandeja.");
    } finally {
      setCargandoLista(false);
    }
  }, [busqueda, filtro]);

  const cargarDetalle = useCallback(async (id: string, silencioso = false) => {
    abortRef.current?.abort();
    const control = new AbortController();
    abortRef.current = control;
    if (!silencioso) setCargandoDetalle(true);
    try {
      const res = await fetch(`/api/admin/whatsapp/conversations/${id}`, { signal: control.signal });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setErrorDetalle(mensajeDeError(json.errorCode, json.error));
        return;
      }
      setErrorDetalle(null);
      setDetalle(json);
    } catch (error) {
      if ((error as Error).name !== "AbortError") setErrorDetalle("No se pudo cargar la conversación.");
    } finally {
      if (!silencioso) setCargandoDetalle(false);
    }
  }, []);

  useEffect(() => { void cargarLista(); }, [cargarLista]);

  // La lista de asesores se pide una vez: cambia poco y pedirla por
  // conversacion seria una peticion por cada clic en la bandeja.
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/admin/users/assignable");
        const json = await res.json();
        if (json?.ok) setAsesores(json.users);
      } catch {
        // Sin lista, el resto de la bandeja sigue siendo usable.
      }
    })();
  }, []);

  /**
   * Refresco periodico, solo con la pestana visible.
   *
   * Seguir consultando con la pestana oculta gasta cuota sin que nadie lo mire.
   * Y el refresco NUNCA toca el borrador ni la conversacion abierta: perder lo
   * que alguien esta escribiendo por una recarga automatica es imperdonable.
   */
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      void cargarLista();
      if (seleccionada) void cargarDetalle(seleccionada, true);
    };
    const id = window.setInterval(tick, POLLING_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [cargarLista, cargarDetalle, seleccionada]);

  async function abrir(id: string) {
    setSeleccionada(id);
    setCitado(null);
    setAviso(null);
    setPanelInfo(false);
    pegadoAbajo.current = true;
    await cargarDetalle(id);
    // Marcar leido una sola vez por conversacion y sesion: repetirlo en cada
    // render seria una peticion por pintado.
    if (!leidas.current.has(id)) {
      leidas.current.add(id);
      try {
        const res = await fetch(`/api/admin/whatsapp/conversations/${id}/read`, { method: "POST" });
        const json = await res.json();
        if (json?.providerWarning) setAviso({ tipo: "ok", texto: "Leído en el CRM; WhatsApp no confirmó la lectura." });
        setConversaciones((previas) => previas.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)));
      } catch {
        // La lectura local ya la hizo el servidor; un fallo aqui no bloquea.
      }
    }
  }

  // El scroll baja solo si quien lee ya estaba abajo: arrancarle la posicion
  // mientras revisa mensajes antiguos es la forma de perder el hilo.
  useEffect(() => {
    const nodo = chatRef.current;
    if (nodo && pegadoAbajo.current && detalle) nodo.scrollTop = nodo.scrollHeight;
  }, [detalle]);

  function alScroll() {
    const nodo = chatRef.current;
    if (!nodo) return;
    pegadoAbajo.current = nodo.scrollHeight - nodo.scrollTop - nodo.clientHeight < 80;
  }

  const visibles = useMemo(() => {
    if (filtro === "no-leidas") return conversaciones.filter((c) => c.unreadCount > 0);
    if (filtro === "sin-vincular") return conversaciones.filter((c) => !c.linked);
    return conversaciones;
  }, [conversaciones, filtro]);

  const inscripciones = detalle?.conversation.lead?.enrollments ?? [];
  const ventana = detalle?.window;
  const plantillaActual = PLANTILLAS_DE_BANDEJA.find((p) => p.key === plantilla);

  async function enviar() {
    if (!detalle || enviando) return;
    const conversationId = detalle.conversation.id;
    if (modo === "text" && !borrador.trim()) return;
    if (!intento.current) intento.current = `ui-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    setEnviando(true);
    setAviso(null);
    try {
      const res = await fetch(`/api/admin/whatsapp/conversations/${conversationId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientRequestId: intento.current,
          mode: modo,
          ...(modo === "text" ? { text: borrador.trim() } : { templateKey: plantilla }),
          ...(inscripcion ? { enrollmentId: inscripcion } : {}),
          ...(citado ? { replyToProviderMessageId: citado.id } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        if (res.status === 429) setAviso({ tipo: "error", texto: "Demasiadas respuestas seguidas. Espera unos segundos." });
        else setAviso({ tipo: "error", texto: mensajeDeError(json.errorCode, json.error) });
        if (json.errorCode === "CONTEXT_FOREIGN") setCitado(null);
        return;
      }
      // Enviado: recien aqui se libera la identidad, para que el siguiente
      // mensaje sea intencionalmente otro.
      intento.current = null;
      setBorrador("");
      setCitado(null);
      setAviso({ tipo: "ok", texto: json.duplicate ? "Ese mensaje ya se había enviado." : "Mensaje enviado." });
      pegadoAbajo.current = true;
      await cargarDetalle(conversationId, true);
      void cargarLista();
    } catch {
      // Resultado incierto: NO se reintenta solo ni se cambia la identidad.
      setAviso({ tipo: "error", texto: "No se pudo confirmar el envío. Actualiza la conversación antes de reintentar." });
    } finally {
      setEnviando(false);
    }
  }

  async function actualizarConversacion(cambios: Record<string, unknown>, exito: string) {
    if (!detalle) return;
    setAviso(null);
    try {
      const res = await fetch(`/api/admin/whatsapp/conversations/${detalle.conversation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cambios),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setAviso({ tipo: "error", texto: mensajeDeError(json.errorCode, json.error) });
        return;
      }
      setAviso({ tipo: "ok", texto: exito });
      await cargarDetalle(detalle.conversation.id, true);
      void cargarLista();
    } catch {
      setAviso({ tipo: "error", texto: "No se pudo guardar el cambio." });
    }
  }

  return (
    <section className="panel inbox">
      <h2>Inbox WhatsApp</h2>

      <div className={`inbox-shell ${seleccionada ? "has-selection" : ""} ${panelInfo ? "shows-info" : ""}`}>
        {/* ---------------- lista ---------------- */}
        <aside className="inbox-list" aria-label="Conversaciones">
          <div className="form-row">
            <input
              type="search"
              value={busqueda}
              onChange={(event) => setBusqueda(event.target.value)}
              placeholder="Buscar nombre o número"
              aria-label="Buscar conversaciones"
            />
          </div>
          <fieldset className="inbox-filters" aria-label="Filtrar conversaciones">
            {FILTROS.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`btn-sm ${filtro === item.key ? "" : "ghost"}`}
                aria-pressed={filtro === item.key}
                onClick={() => setFiltro(item.key)}
              >
                {item.label}
              </button>
            ))}
          </fieldset>

          {cargandoLista ? <p className="muted">Cargando conversaciones…</p> : null}
          {errorLista ? <p className="result-line is-error" role="status">{errorLista}</p> : null}
          {!cargandoLista && !errorLista && visibles.length === 0 ? (
            <p className="muted">
              {busqueda.trim() ? "Ninguna conversación coincide con la búsqueda." : "Todavía no hay conversaciones de WhatsApp."}
            </p>
          ) : null}

          <ul className="inbox-items">
            {visibles.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`inbox-item ${seleccionada === item.id ? "is-active" : ""}`}
                  onClick={() => void abrir(item.id)}
                  aria-pressed={seleccionada === item.id}
                >
                  <span className="inbox-item-top">
                    <strong>{item.name}</strong>
                    {item.unreadCount > 0 ? <span className="badge" role="img" aria-label={`${item.unreadCount} sin leer`}>{item.unreadCount}</span> : null}
                  </span>
                  <span className="muted">{item.phonePartial} · {ESTADO_TEXTO[item.state]}</span>
                  {item.lastMessage ? <span className="inbox-preview">{item.lastMessage.preview}</span> : null}
                  <span className="muted">
                    {item.lastMessage ? hora(item.lastMessage.at) : "—"} · {item.window.open ? "Ventana abierta" : "Ventana cerrada"}
                    {item.assignedTo ? ` · ${item.assignedTo.name}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {cursor ? (
            <button type="button" className="btn-sm ghost" onClick={() => void cargarLista({ cursor, reemplazar: false })}>
              Cargar más
            </button>
          ) : null}
        </aside>

        {/* ---------------- chat ---------------- */}
        <div className="inbox-chat">
          {!seleccionada ? (
            <p className="muted">Elige una conversación para verla.</p>
          ) : cargandoDetalle ? (
            <p className="muted">Cargando conversación…</p>
          ) : errorDetalle ? (
            <p className="result-line is-error" role="status">{errorDetalle}</p>
          ) : detalle ? (
            <>
              <header className="inbox-header">
                <button type="button" className="btn-sm ghost inbox-back" onClick={() => setSeleccionada(null)}>
                  ← Conversaciones
                </button>
                <div>
                  <strong>{detalle.conversation.lead?.name ?? "Contacto no vinculado"}</strong>
                  <p className="muted">
                    …{detalle.conversation.phone.slice(-4)} · {ESTADO_TEXTO[detalle.conversation.state]}
                    {detalle.conversation.assignedTo ? ` · ${detalle.conversation.assignedTo.name}` : " · sin asesor"}
                  </p>
                  <p className={`muted ${ventana?.open ? "" : "is-warning"}`}>{ventana ? textoDeVentana(ventana) : ""}</p>
                </div>
                <button type="button" className="btn-sm ghost" onClick={() => setPanelInfo((v) => !v)} aria-expanded={panelInfo}>
                  Información
                </button>
              </header>

              {detalle.conversation.state === "HUMAN_HANDOFF" ? (
                <p className="muted inbox-note">
                  Durante la atención humana, los mensajes comerciales automáticos se pausan para este contacto.
                  Los recordatorios operativos continúan.
                </p>
              ) : null}

              <div className="inbox-messages" ref={chatRef} onScroll={alScroll} role="log" aria-label="Mensajes">
                {detalle.messages.length === 0 ? <p className="muted">Esta conversación todavía no tiene mensajes.</p> : null}
                {detalle.messages.map((m) => {
                  const etiquetaTipo = etiquetaDeTipo(m.type, m.attachment);
                  return (
                    <article key={m.id} className={`bubble ${m.direction === "INBOUND" ? "is-inbound" : "is-outbound"}`}>
                      <p className="bubble-meta">
                        {m.origin === "CONTACT" ? "Contacto" : m.origin === "HUMAN" ? `Asesor${m.actor ? ` · ${m.actor}` : ""}` : "Automatización"}
                        {" · "}{hora(m.at)}
                      </p>
                      {etiquetaTipo ? <p className="bubble-kind">{etiquetaTipo}</p> : null}
                      {/* Texto plano: nunca HTML del contacto. */}
                      {m.text ? <p className="bubble-text">{m.text}</p> : null}
                      {m.status ? <p className="bubble-meta">{etiquetaDeEstado(m.status)}</p> : null}
                      {m.direction === "INBOUND" ? (
                        <button
                          type="button"
                          className="btn-sm ghost"
                          onClick={() => setCitado({ id: m.id, preview: (m.text ?? etiquetaTipo).slice(0, 60) })}
                        >
                          Responder
                        </button>
                      ) : null}
                    </article>
                  );
                })}
              </div>

              {/* ---------------- composer ---------------- */}
              <div className="inbox-composer">
                {!detalle.conversation.linked ? (
                  <p className="result-line is-error" role="status">
                    Contacto no vinculado. Vincúlalo desde Información para poder responder.
                  </p>
                ) : null}

                {citado ? (
                  <p className="muted">
                    Respondiendo a: “{citado.preview}”{" "}
                    <button type="button" className="btn-sm ghost" onClick={() => setCitado(null)} aria-label="Cancelar respuesta">✕</button>
                  </p>
                ) : null}

                {ventana?.open ? (
                  <>
                    <label className="sr-only" htmlFor="inbox-texto">Mensaje</label>
                    <textarea
                      id="inbox-texto"
                      value={borrador}
                      onChange={(event) => setBorrador(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          void enviar();
                        }
                      }}
                      placeholder="Escribe tu respuesta. Enter envía, Shift+Enter salta de línea."
                      rows={3}
                      disabled={!detalle.conversation.linked}
                    />
                    <div className="form-row">
                      <button type="button" className="btn-sm" disabled={enviando || !borrador.trim() || !detalle.conversation.linked} onClick={() => void enviar()}>
                        {enviando ? "Enviando…" : "Enviar"}
                      </button>
                      {borrador.length > 3_500 ? <span className="muted">{borrador.length} / 4000</span> : null}
                    </div>
                  </>
                ) : (
                  <>
                    <p className="muted">
                      WhatsApp cerró la ventana de atención. Para volver a escribir, utiliza una plantilla aprobada.
                    </p>
                    <div className="form-row">
                      <label className="sr-only" htmlFor="inbox-plantilla">Plantilla</label>
                      <select id="inbox-plantilla" value={plantilla} onChange={(event) => { setPlantilla(event.target.value); setModo("template"); }}>
                        {PLANTILLAS_DE_BANDEJA.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                      </select>
                      {inscripciones.length > 1 ? (
                        <>
                          <label className="sr-only" htmlFor="inbox-inscripcion">Inscripción</label>
                          <select id="inbox-inscripcion" value={inscripcion} onChange={(event) => setInscripcion(event.target.value)}>
                            <option value="">Elige la inscripción</option>
                            {inscripciones.map((e) => <option key={e.id} value={e.id}>{e.course.title}</option>)}
                          </select>
                        </>
                      ) : null}
                      <button
                        type="button"
                        className="btn-sm"
                        disabled={enviando || !detalle.conversation.linked}
                        onClick={() => { setModo("template"); void enviar(); }}
                      >
                        {enviando ? "Enviando…" : "Enviar plantilla"}
                      </button>
                    </div>
                    {plantillaActual ? <p className="muted">Usa: {plantillaActual.variables.join(", ")}</p> : null}
                  </>
                )}

                {aviso ? <p className={`result-line ${aviso.tipo === "error" ? "is-error" : ""}`} role="status">{aviso.texto}</p> : null}
              </div>
            </>
          ) : null}
        </div>

        {/* ---------------- información ---------------- */}
        {panelInfo ? <div className="inbox-info-backdrop" aria-hidden="true" onClick={() => setPanelInfo(false)} /> : null}
        {detalle ? (
          <aside className="inbox-info" aria-label="Información del contacto">
            <h3>Contacto</h3>
            {detalle.conversation.lead ? (
              <>
                <p><strong>{detalle.conversation.lead.name}</strong></p>
                <p className="muted">{detalle.conversation.lead.email ?? "Sin correo"}</p>
                <Link className="btn-sm ghost" href={`/admin/leads/${detalle.conversation.lead.id}`}>Ver ficha completa</Link>
              </>
            ) : (
              <ContactoSinVincular
                phone={detalle.conversation.phone}
                onVincular={(leadId) => void actualizarConversacion({ leadId }, "Contacto vinculado.")}
              />
            )}

            <h3>Cursos</h3>
            {inscripciones.length === 0 ? (
              <p className="muted">Sin inscripciones registradas.</p>
            ) : (
              <ul className="inbox-enrollments">
                {inscripciones.map((e) => (
                  <li key={e.id}>{e.course.title} <span className="muted">· {e.status}</span></li>
                ))}
              </ul>
            )}

            <h3>Atención</h3>
            <label className="sr-only" htmlFor="inbox-asesor">Asesor responsable</label>
            <select
              id="inbox-asesor"
              value={detalle.conversation.assignedTo?.id ?? ""}
              disabled={asignando}
              onChange={async (event) => {
                const valor = event.target.value;
                setAsignando(true);
                await actualizarConversacion({ assignedToId: valor || null }, valor ? "Asesor asignado." : "Asignación retirada.");
                setAsignando(false);
              }}
            >
              <option value="">Sin asignar</option>
              {asesores.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.role}</option>)}
            </select>
            {asignando ? <p className="muted">Guardando…</p> : null}
            <p className="muted">{ESTADO_TEXTO[detalle.conversation.state]}</p>
            <p className="muted">{ventana ? textoDeVentana(ventana) : ""}</p>
            <div className="form-row">
              {detalle.conversation.state === "HUMAN_HANDOFF" ? (
                <button type="button" className="btn-sm" onClick={() => void actualizarConversacion({ state: "RESOLVED" }, "Atención cerrada.")}>
                  Cerrar atención
                </button>
              ) : (
                <button type="button" className="btn-sm ghost" onClick={() => void actualizarConversacion({ state: "HUMAN_HANDOFF" }, "Atención reabierta.")}>
                  Reabrir atención
                </button>
              )}
            </div>
          </aside>
        ) : null}
      </div>
    </section>
  );
}

/**
 * Vinculacion manual de un contacto.
 *
 * No crea contactos: el backend exige ademas que el telefono coincida, asi que
 * lo unico que se puede hacer aqui es senalar cual de los que ya existen es.
 */
function ContactoSinVincular({ phone, onVincular }: { phone: string; onVincular: (leadId: string) => void }) {
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState<Array<{ id: string; fullName: string; email: string | null }>>([]);
  const [buscando, setBuscando] = useState(false);

  async function buscar() {
    if (!texto.trim()) return;
    setBuscando(true);
    try {
      const res = await fetch(`/api/admin/leads?search=${encodeURIComponent(texto.trim())}&limit=8`);
      const json = await res.json().catch(() => null);
      setResultados(Array.isArray(json?.leads) ? json.leads.slice(0, 8) : []);
    } catch {
      setResultados([]);
    } finally {
      setBuscando(false);
    }
  }

  return (
    <div>
      <p className="result-line is-error" role="status">Contacto no vinculado</p>
      <p className="muted">Número: …{phone.slice(-4)}</p>
      <div className="form-row">
        <label className="sr-only" htmlFor="inbox-buscar-lead">Buscar contacto</label>
        <input id="inbox-buscar-lead" value={texto} onChange={(event) => setTexto(event.target.value)} placeholder="Nombre o correo" />
        <button type="button" className="btn-sm ghost" disabled={buscando} onClick={() => void buscar()}>
          {buscando ? "Buscando…" : "Buscar"}
        </button>
      </div>
      <ul className="inbox-enrollments">
        {resultados.map((lead) => (
          <li key={lead.id}>
            {lead.fullName} <span className="muted">{lead.email ?? ""}</span>{" "}
            <button type="button" className="btn-sm" onClick={() => onVincular(lead.id)}>Vincular</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
