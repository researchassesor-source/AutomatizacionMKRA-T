import { AdminIcon } from "../AdminIcon";
import { TechnicalOnly } from "../TechnicalDetail";
import { formatMoment } from "@/lib/message-presentation";

/**
 * Que recibe cada inscrito y cuando.
 *
 * Es la vista que faltaba. Para saber lo mismo habia que abrir el gestor de
 * automatizaciones, entender que es un disparador y traducir un desplazamiento
 * en minutos a una hora concreta. Aqui se lee de un vistazo, y ademas se ve al
 * instante que le falta a cada paso para poder salir.
 */
export type TimelineStep = {
  planKey: string;
  /** Momento relativo, en palabras: "Al inscribirse", "2 horas antes". */
  when: string;
  title: string;
  detail: string;
  channels: Array<"EMAIL" | "WHATSAPP">;
  /** Fecha real calculada, si el curso ya tiene calendario. */
  scheduledAt: Date | null;
  active: boolean;
  /** Motivo por el que este paso no puede salir todavia. */
  blockedReason: string | null;
  /** Nombres internos de las reglas, solo para el perfil tecnico. */
  ruleNames: string[];
};

function stateClass(step: TimelineStep): string {
  if (step.blockedReason) return "is-blocked";
  if (!step.active) return "is-off";
  return "is-active";
}

export function CourseTimeline({ steps, hasSchedule, sessionsHref }: { steps: TimelineStep[]; hasSchedule: boolean; sessionsHref: string }) {
  return (
    <>
      {steps.some((step) => step.blockedReason) ? <div className="timeline-config-note"><span><strong>Requiere configuración.</strong> Completa la sesión o el enlace pendiente para habilitar los avisos.</span><a className="btn-sm ghost" href={sessionsHref}>Ir a Sesiones</a></div> : null}
      <div className="timeline">
      {steps.map((step) => (
        <div className={`timeline-step ${stateClass(step)}`} key={step.planKey}>
          <div className="timeline-rail" aria-hidden="true"><span /></div>
          <div className="timeline-when">{step.when}</div>
          <div className="timeline-what">
            <strong>
              {step.title}
              {step.channels.map((channel) => (
                <span className="timeline-channel" key={channel} title={channel === "EMAIL" ? "Correo" : "WhatsApp"}>
                  <AdminIcon name={channel === "EMAIL" ? "messages" : "social"} size={14} />
                </span>
              ))}
            </strong>
            <small>{step.blockedReason ?? step.detail}</small>
            {step.ruleNames.map((name) => <TechnicalOnly key={name}>{name}</TechnicalOnly>)}
          </div>
          <div className="timeline-date">
            {step.scheduledAt
              ? formatMoment(step.scheduledAt)
              : <span className="muted">{hasSchedule ? "—" : "sin fecha"}</span>}
            <small>{step.blockedReason ? "Requiere configuración" : step.active ? "Activo" : "Desactivado"}</small>
          </div>
        </div>
      ))}
      </div>
    </>
  );
}
