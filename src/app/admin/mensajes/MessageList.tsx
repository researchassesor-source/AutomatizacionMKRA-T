"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { TechnicalSection } from "../TechnicalDetail";
import { MessageActions } from "./MessageActions";
import { formatMoment, humanReason, humanStatusFor, messageMoment, relativeMoment, statusDotClass } from "@/lib/message-presentation";
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
  createdAt: Date;
  sentAt: Date | null;
  acceptedAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  bouncedAt: Date | null;
  failedAt: Date | null;
  cancelledAt: Date | null;
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

function dayKey(date: Date): string {
  return new Intl.DateTimeFormat("es-EC", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "America/Guayaquil" }).format(date).replace(/[\u00a0\u202f]/g, " ");
}

function dayLabel(date: Date, now: Date): string {
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getTime() - 86_400_000));
  const key = dayKey(date);
  if (key === today) return "Hoy";
  if (key === yesterday) return "Ayer";
  return new Intl.DateTimeFormat("es-EC", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Guayaquil" }).format(date).replace(/[\u00a0\u202f]/g, " ");
}

function meaningfulMoment(message: MessageRow): { text: string; detail: string } {
  const moment = messageMoment(message);
  return { text: `${moment.label}: ${formatMoment(moment.at)}`, detail: relativeMoment(moment.at) };
}

export function MessageList({ messages, now, technical }: { messages: MessageRow[]; now: Date; technical: boolean }) {
  const [pageSize, setPageSize] = useState(25);
  const [visibleCount, setVisibleCount] = useState(25);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const messageSetKey = messages.map((message) => message.id).join("|");

  useEffect(() => {
    void messageSetKey;
    setVisibleCount(pageSize);
    setSelectedId(null);
  }, [messageSetKey, pageSize]);

  useEffect(() => {
    if (!selectedId) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedId]);

  const visibleMessages = messages.slice(0, visibleCount);
  const selected = messages.find((message) => message.id === selectedId) ?? null;
  const groups = useMemo(() => {
    const result: Array<{ label: string; items: MessageRow[] }> = [];
    for (const message of visibleMessages) {
      const label = dayLabel(new Date(messageMoment(message).at), now);
      const last = result.at(-1);
      if (last?.label === label) last.items.push(message);
      else result.push({ label, items: [message] });
    }
    return result;
  }, [now, visibleMessages]);

  return (
    <>
      <fieldset className="table-presentation-toolbar"><legend className="sr-only">Controles de presentación</legend>
        <span>Mostrando {Math.min(visibleCount, messages.length)} de {messages.length}</span>
        <label>
          Filas por bloque
          <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
            <option value="25">25</option>
            <option value="50">50</option>
          </select>
        </label>
      </fieldset>

      <div className="message-groups">
        {groups.map((group) => (
          <section className="message-group" key={group.label}>
            <h3 className="message-group-title">{group.label} <span>{group.items.length}</span></h3>
            <div className="table-wrap message-table-wrap">
              <table className="data message-table">
                <thead><tr><th>Destinatario</th><th>Mensaje</th><th>Canal</th><th>Estado</th><th>Fecha</th><th aria-label="Acciones" /></tr></thead>
                <tbody>
                  {group.items.map((message) => {
                    const human = humanStatusFor(message.status, message.scheduledAt, now);
                    const reason = human.tone === "problem" || human.tone === "blocked" ? humanReason(message.errorCode, message.errorMessage ?? message.error) : null;
                    const when = meaningfulMoment(message);
                    return (
                      <tr className="message-table-row" key={message.id}>
                        <td className="message-recipient-cell" data-label="Destinatario">
                          <Link href={`/admin/leads/${message.leadId}`} className="row-title">{message.leadName}</Link>
                          <div className="muted row-truncate">{message.toAddress}</div>
                        </td>
                        <td className="message-preview-cell" data-label="Mensaje">
                          <strong className="row-title row-truncate">{message.subject ?? (message.channel === "WHATSAPP" ? "Mensaje de WhatsApp" : "Sin asunto")}</strong>
                          <div className="muted row-truncate">{message.courseTitle ?? "Sin curso"}</div>
                        </td>
                        <td className="message-channel-cell" data-label="Canal">{message.channel === "EMAIL" ? "Correo" : "WhatsApp"}</td>
                        <td className="message-status-cell" data-label="Estado">
                          <span className={statusDotClass(message.status, message.scheduledAt, now)}>{human.label}</span>
                          <div className="muted row-status-hint">{reason ?? human.hint}</div>
                        </td>
                        <td className="message-date-cell" data-label="Fecha"><span className="row-when">{when.text}</span><div className="muted">{when.detail}</div></td>
                        <td className="row-actions-cell"><MessageActions id={message.id} status={message.status} onView={() => setSelectedId(message.id)} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>

      {visibleCount < messages.length ? (
        <div className="table-more"><button type="button" className="btn-sm ghost" onClick={() => setVisibleCount((count) => count + pageSize)}>Mostrar {Math.min(pageSize, messages.length - visibleCount)} más</button></div>
      ) : null}

      {selected ? (
        <div className="dialog-backdrop message-detail-backdrop" role="presentation">
          <section className="dialog is-wide message-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="message-detail-title">
            <header><div><span className="eyebrow">Detalle de comunicación</span><h2 id="message-detail-title">{selected.subject ?? (selected.channel === "WHATSAPP" ? "Mensaje de WhatsApp" : "Sin asunto")}</h2></div><button type="button" className="admin-dialog-close" aria-label="Cerrar detalle" onClick={() => setSelectedId(null)}>×</button></header>
            <dl className="detail-list message-detail-summary">
              <dt>Destinatario</dt><dd>{selected.leadName} · {selected.toAddress}</dd>
              <dt>Curso</dt><dd>{selected.courseTitle ?? "Sin curso"}</dd>
              <dt>Canal</dt><dd>{selected.channel === "EMAIL" ? "Correo electrónico" : "WhatsApp"}</dd>
              <dt>{messageMoment(selected).label}</dt><dd>{formatMoment(messageMoment(selected).at)}</dd>
            </dl>
            <div className="message-detail-body"><h3>Contenido</h3><p>{selected.body}</p></div>
            <TechnicalSection visible={technical}>
              <details className="technical-context">
                <summary>Ver detalle técnico</summary>
                <dl className="detail-list">
                  <dt>Estado interno</dt><dd>{selected.status}</dd>
                  <dt>Identificador</dt><dd>{selected.id}</dd>
                  <dt>Proveedor</dt><dd>{selected.providerName ?? "Sin proveedor"}</dd>
                  <dt>Referencia del proveedor</dt><dd>{selected.providerMessageId ?? "—"}</dd>
                  <dt>Intentos</dt><dd>{selected.attemptCount}</dd>
                  <dt>Código de diagnóstico</dt><dd>{selected.errorCode ?? "—"}</dd>
                  <dt>Diagnóstico</dt><dd>{selected.errorMessage ?? selected.error ?? "Sin incidencias"}</dd>
                </dl>
              </details>
            </TechnicalSection>
          </section>
        </div>
      ) : null}
    </>
  );
}
