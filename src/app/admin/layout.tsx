import { AdminSessionProvider } from "./AdminSession";
import { FeedbackProvider } from "./Feedback";

/**
 * Envoltura comun del panel. Resuelve la sesion una vez y deja el perfil
 * disponible para toda la seccion, incluido el interruptor de detalle tecnico.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminSessionProvider><FeedbackProvider>{children}</FeedbackProvider></AdminSessionProvider>;
}
