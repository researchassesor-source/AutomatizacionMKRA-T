import Link from "next/link";
import { TechnicalOnly } from "../TechnicalDetail";
import { MessageActions } from "./MessageActions";
import { formatDay, formatTime, humanReason, humanStatusFor, relativeMoment, statusDotClass } from "@/lib/message-presentation";
import type { MessageChannel, MessageStatus } from "@prisma/client";

export type MessageRow = {
  id: string;
  leadId: string;
  channel: MessageChannel;
  status: MessageStatus;
  toAddress: string;
  subject: string | null;
  body: string;
  scheduledAt: Date;
  acceptedAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
  error: string | null;
  providerName: string | null;
  providerMessageId: string | null;
  attemptCount: number;
  isSimulation: boolean;
  leadName: string;
  courseTitle: string | null;
  courseId: string | null;
};

/**
 * Historial de mensajes agrupado por dia.
 *
 * Doscientas filas seguidas obligan a leer la fecha de cada una para situarse.
 * Con un encabezado por dia, la fecha se lee una vez y las filas quedan libres
 * para lo que de verdad cambia entre ellas.
 */
function dayKey(date: Date): string {
  return new Intl.DateTimeFormat("es-EC", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "America/Guayaquil" }).format(date);
}

function dayLabel(date: Date, now: Date): string {
  const hoy = dayKey(now);
  const ayer = dayKey(new Date(now.getTime() - 86_400_000));
  const key = dayKey(date);
  if (key === hoy) return "Hoy";
  if (key === ayer) return "Ayer";
  return new Intl.DateTimeFormat("es-EC", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Guayaquil" }).format(date);
}

/** Momento que de verdad importa mostrar segun el estado del mensaje. */
function moment(message: MessageRow): { texto: string; detalle: string } {
  if (message.readAt) return { texto: relativeMoment(message.readAt), detalle: `Leído ${formatTime(message.readAt)}` };
  if (message.deliveredAt) return { texto: relativeMoment(message.deliveredAt), detalle: `Recibido ${formatTime(message.deliveredAt)}` };
  if (message.acceptedAt) return { texto: relativeMoment(message.acceptedAt), detalle: `Enviado ${formatTime(message.acceptedAt)}` };
  return { texto: relativeMoment(message.scheduledAt), detalle: `Previsto ${formatTime(message.scheduledAt)}` };
}

export function MessageList({ messages, now }: { messages: MessageRow[]; now: Date }) {
  const grupos: Array<{ label: string; items: MessageRow[] }> = [];
  for (const message of messages) {
    const label = dayLabel(message.scheduledAt, now);
    const ultimo = grupos.at(-1);
    if (ultimo?.label === label) ultimo.items.push(message);
    else grupos.push({ label, items: [message] });
  }

  return (
    <div className="message-groups">
      {grupos.map((grupo) => (
        <section className="message-group" key={grupo.label}>
          <h3 className="message-group-title">
            {grupo.label} <span>{grupo.items.length}</span>
          </h3>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Contacto</th>
                  <th>Mensaje</th>
                  <th>Estado</th>
                  <th>Cuándo</th>
                  <th aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {grupo.items.map((message) => {
                  const humano = humanStatusFor(message.status, message.scheduledAt, now);
                  const motivo = humano.tone === "problem" || humano.tone === "blocked" ? humanReason(message.errorCode, message.errorMessage ?? message.error) : null;
                  const cuando = moment(message);
                  return (
                    <tr key={message.id}>
                      <td>
                        <Link href={`/admin/leads/${message.leadId}`} className="row-title">{message.leadName}</Link>
                        <div className="muted">{message.channel === "EMAIL" ? "Correo" : "WhatsApp"} · {message.toAddress}</div>
                      </td>
                      <td>
                        <strong className="row-title">{message.subject ?? (message.channel === "WHATSAPP" ? "Mensaje de WhatsApp" : "Sin asunto")}</strong>
                        <div className="muted">{message.courseTitle ?? "Sin curso"}</div>
                        <details className="row-details">
                          <summary>Ver texto</summary>
                          <p className="message-body">{message.body}</p>
                        </details>
                      </td>
                      <td>
                        <span className={statusDotClass(message.status, message.scheduledAt)}>
                          {humano.label}
                        </span>
                        <div className="muted">{motivo ?? humano.hint}</div>
                        {humano.tone === "blocked" && message.courseId ? (
                          <Link className="row-fix" href={`/admin/cursos/${message.courseId}?tab=calendario`}>Ir a Sesiones →</Link>
                        ) : null}
                        <TechnicalOnly>{message.status}</TechnicalOnly>
                        {message.errorCode ? <TechnicalOnly>{message.errorCode}</TechnicalOnly> : null}
                        {message.providerMessageId ? <TechnicalOnly>{message.providerMessageId}</TechnicalOnly> : null}
                        {message.attemptCount > 1 ? <TechnicalOnly>{message.attemptCount} intentos</TechnicalOnly> : null}
                        {message.providerName ? <TechnicalOnly>{message.providerName}</TechnicalOnly> : null}
                      </td>
                      <td>
                        <span className="row-when">{cuando.texto}</span>
                        <div className="muted">{formatDay(message.scheduledAt)} · {cuando.detalle}</div>
                      </td>
                      <td><MessageActions id={message.id} status={message.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
