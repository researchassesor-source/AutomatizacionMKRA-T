import Image from "next/image";
import Link from "next/link";

export function AppLogo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="app-logo" aria-label="R.A. Training CRM">
      <Image src="/crm-logo.png" alt="" width={64} height={64} priority />
      {!compact && (
        <span>
          <strong>R.A. Training CRM</strong>
          <small>Sistema de Gestión de Relaciones con Clientes</small>
        </span>
      )}
    </Link>
  );
}
