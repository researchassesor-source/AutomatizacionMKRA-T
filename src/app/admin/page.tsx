import Link from "next/link";
import { currentAdminSession } from "@/lib/auth/server";
import { resolveViewMode } from "@/lib/auth/view-mode";
import { loadDashboard } from "@/lib/dashboard";
import { formatDay, formatTime, relativeMoment } from "@/lib/message-presentation";
import { AdminIcon } from "./AdminIcon";
import { AdminNav } from "./AdminNav";
import { HealthStrip } from "./HealthStrip";
import { ScheduleSessionButton } from "./cursos/ScheduleSessionButton";
import { ImportScheduleButton } from "./cursos/ImportScheduleButton";

export const dynamic = "force-dynamic";

function greeting(now: Date): string {
  const hour = Number(new Intl.DateTimeFormat("es-EC", { hour: "numeric", hour12: false, timeZone: "America/Guayaquil" }).format(now));
  if (hour < 12) return "Buenos días";
  if (hour < 19) return "Buenas tardes";
  return "Buenas noches";
}

function firstName(fullName: string): string {
  return fullName.split(/\s+/).filter(Boolean)[0] ?? fullName;
}

function trend(current: number, previous: number): string | null {
  // Sin base de comparacion un porcentaje no significa nada: mejor callar.
  if (previous === 0) return current > 0 ? "primera semana con registros" : null;
  const change = Math.round(((current - previous) / previous) * 100);
  if (change === 0) return "igual que la semana pasada";
  return `${change > 0 ? "+" : ""}${change}% frente a la semana pasada`;
}

export default async function AdminHome() {
  const session = await currentAdminSession();
  const vista = await resolveViewMode(session.role);
  const now = new Date();
  const data = await loadDashboard(now);

  const fecha = new Intl.DateTimeFormat("es-EC", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "America/Guayaquil" }).format(now);
  const pendientes = data.attention.length;

  return (
    <main className="container admin-shell">
      <AdminNav view={vista} />

      <header className="home-header">
        <h1>{greeting(now)}, {firstName(session.name)}</h1>
        <p className="home-date">{fecha.charAt(0).toUpperCase() + fecha.slice(1)}</p>
        <p className={`home-state ${pendientes > 0 ? "is-attention" : ""}`}>
          {pendientes > 0
            ? `${pendientes} ${pendientes === 1 ? "cosa necesita" : "cosas necesitan"} tu atención.`
            : "Todo marcha correctamente."}
        </p>
      </header>

      {vista === "tecnica" ? <HealthStrip /> : null}

      <section className={`home-review ${pendientes > 0 ? "is-attention" : ""}`}>
        {pendientes > 0
          ? <><strong>{pendientes}</strong> {pendientes === 1 ? "cosa necesita revisión" : "cosas necesitan revisión"}. Puedes verlas al final de esta página.</>
          : <>Nada pendiente de revisar.</>}
        {pendientes > 0 ? <a className="btn-sm ghost" href="#revisar">Ver qué falta</a> : null}
      </section>


      <section aria-label="Cifras de la semana" className="home-block">
        <div className="kpi-row">
          <Link className="kpi" href="/admin/leads">
            <span>Contactos nuevos</span>
            <strong>{data.contactsThisWeek}</strong>
            <small>{trend(data.contactsThisWeek, data.contactsPreviousWeek) ?? "esta semana"}</small>
          </Link>
          <Link className="kpi" href="/admin/leads">
            <span>Inscripciones</span>
            <strong>{data.enrollments}</strong>
            <small>{data.enrollmentsThisWeek > 0 ? `${data.enrollmentsThisWeek} esta semana` : "en total"}</small>
          </Link>
          <Link className="kpi" href="/admin/cursos">
            <span>Próximas sesiones</span>
            <strong>{data.upcomingSessionsCount}</strong>
            <small>{data.upcomingSessionsCount === 0 ? "sin fechas cargadas" : "programadas"}</small>
          </Link>
          <Link className="kpi" href="/admin/mensajes">
            <span>Mensajes enviados</span>
            <strong>{data.messagesSent}</strong>
            <small>{data.messagesSentThisWeek > 0 ? `${data.messagesSentThisWeek} esta semana` : "en total"}</small>
          </Link>
        </div>
      </section>

      <section aria-labelledby="sesiones-titulo" className="home-block">
        <h2 id="sesiones-titulo" className="home-block-title">Próximas sesiones</h2>
        {data.sessions.length === 0 ? (
          <div className="home-empty">
            <p><strong>Aún no hay sesiones programadas.</strong></p>
            <p>Tienes cursos con personas inscritas. Programa la primera sesión para activar sus recordatorios.</p>
            <Link className="btn-sm" href="/admin/cursos">Ir a Cursos</Link>
          </div>
        ) : (
          <div className="session-list">
            {data.sessions.map((session_) => (
              <article className="session-card" key={`${session_.courseId}-${session_.startAt.toISOString()}`}>
                <div className="session-main">
                  <strong>{session_.courseTitle}</strong>
                  <span className="session-when">{formatDay(session_.startAt)} · {formatTime(session_.startAt)}</span>
                  <small>
                    {session_.modality ? `${session_.modality} · ` : ""}
                    {session_.enrollments} inscrito{session_.enrollments === 1 ? "" : "s"}
                  </small>
                </div>
                <span className={`status-dot ${session_.hasStreamUrl ? "is-done" : "is-attention"}`}>
                  {session_.hasStreamUrl ? "Listo" : "Falta enlace"}
                </span>
                <Link className="btn-sm ghost" href={`/admin/cursos#curso-${session_.courseId}`}>Ver curso</Link>
              </article>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="actividad-titulo" className="home-block">
        <h2 id="actividad-titulo" className="home-block-title">Actividad reciente</h2>
        {data.activity.length === 0 ? (
          <p className="muted">Todavía no hay actividad registrada.</p>
        ) : (
          <ul className="activity-list">
            {data.activity.map((item) => (
              <li key={item.id}>
                <AdminIcon name={item.kind === "contacto" ? "contacts" : item.kind === "mensaje" ? "messages" : "social"} size={16} />
                <span>{item.text}</span>
                <time dateTime={item.at.toISOString()}>{relativeMoment(item.at, now)}</time>
              </li>
            ))}
          </ul>
        )}
      </section>
      <details className="home-attention" id="revisar" open={pendientes > 0}>
        <summary>Qué necesita revisión</summary>
        {data.attention.length === 0 ? (
          <div className="attention-empty">
            <AdminIcon name="secure" size={18} />
            <span><strong>Todo al día.</strong> No tienes acciones pendientes por ahora.</span>
          </div>
        ) : (
          <div className="attention-list">
            {data.attention.map((item) => (
              <article className={`attention-item ${item.severity === "error" ? "is-error" : ""}`} key={item.id}>
                <div className="attention-copy">
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                </div>
                {item.scheduleCourse ? (
                  <ImportScheduleButton courseId={item.scheduleCourse.id} enrollments={item.scheduleCourse.enrollments} />
                ) : null}
                {item.scheduleCourse ? (
                  <ScheduleSessionButton
                    courseId={item.scheduleCourse.id}
                    courseTitle={item.scheduleCourse.title}
                    enrollments={item.scheduleCourse.enrollments}
                    modality={item.scheduleCourse.modality}
                    label={item.actionLabel}
                  />
                ) : (
                  <Link className="btn-sm" href={item.href}>{item.actionLabel}</Link>
                )}
              </article>
            ))}
          </div>
        )}
      </details>
    </main>
  );
}
