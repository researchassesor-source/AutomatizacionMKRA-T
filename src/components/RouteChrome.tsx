"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AppLogo } from "./AppLogo";
import { WhatsAppButton } from "@/app/WhatsAppButton";

const catalogUrl = process.env.NEXT_PUBLIC_COURSE_CATALOG_URL ?? "https://ra-training.com/courses-1/";

export function RouteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname.startsWith("/admin")) return <>{children}</>;
  return (
    <>
      <header className="site-header">
        <div className="container site-header-inner">
          <AppLogo />
          <nav className="site-nav" aria-label="Navegación principal">
            <a href={catalogUrl}>Cursos</a>
            <Link href="/admin">Panel CRM</Link>
          </nav>
        </div>
      </header>
      {children}
      <footer className="footer">
        <div className="container footer-inner">
          <span>R.A. Training CRM</span>
          <span>Sistema de Gestión de Relaciones con Clientes</span>
        </div>
      </footer>
      <WhatsAppButton />
    </>
  );
}
