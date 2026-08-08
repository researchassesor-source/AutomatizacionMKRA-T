"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AdminIcon, type AdminIconName } from "./AdminIcon";
import { profileLabel } from "@/lib/auth/roles";
import type { ViewMode } from "@/lib/auth/view-mode-shared";
import { useAdminSession } from "./AdminSession";
import { ViewSwitch } from "./ViewSwitch";

type AdminLink = { href: string; label: string; icon: AdminIconName };

/**
 * Navegacion.
 *
 * Cinco destinos de trabajo, usuarios aparte, y la sala de maquinas solo en la
 * vista tecnica. Las secciones retiradas (seguimientos, ventas, campanas,
 * plantillas) conservan codigo, datos y rutas; ninguna tenia un solo registro.
 *
 * Lo que decide que se ve es la VISTA, no el rol: asi el perfil tecnico puede
 * comprobar exactamente lo que vera direccion sin cambiar de cuenta.
 */
const TRABAJO: AdminLink[] = [
  { href: "/admin", label: "Inicio", icon: "overview" },
  { href: "/admin/leads", label: "Contactos", icon: "contacts" },
  { href: "/admin/cursos", label: "Cursos", icon: "courses" },
  { href: "/admin/mensajes", label: "Comunicaciones", icon: "messages" },
  { href: "/admin/revisar", label: "Revisar", icon: "alert" },
  { href: "/admin/redes", label: "Publicaciones", icon: "social" },
];

const GESTION_LINKS: AdminLink[] = [
  { href: "/admin/usuarios", label: "Usuarios", icon: "users" },
];

const SISTEMA: AdminLink[] = [
  { href: "/admin/mensajes?vista=integraciones", label: "Integraciones", icon: "activity" },
  { href: "/admin/automatizaciones", label: "Automatizaciones", icon: "calendar" },
  { href: "/admin/cursos?vista=catalogo", label: "Catálogo", icon: "courses" },
  { href: "/admin/certificados", label: "Envíos a Finance", icon: "finance" },
  { href: "/admin/auditoria", label: "Auditoría", icon: "audit" },
];

const TODOS = [...TRABAJO, ...GESTION_LINKS, ...SISTEMA];

export function AdminNav({ view }: { view: ViewMode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { role, name, legacy, technical } = useAdminSession();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (pathname) setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const menuButton = menuButtonRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      if (event.key !== "Tab") return;
      const focusable = Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? []);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.requestAnimationFrame(() => sidebarRef.current?.querySelector<HTMLElement>("a")?.focus());
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
      menuButton?.focus();
    };
  }, [open]);

  const currentPage = useMemo(() => {
    return TODOS
      .map((item) => ({ ...item, path: item.href.split("?")[0] }))
      .filter((item) => pathname === item.path || (item.path !== "/admin" && pathname.startsWith(`${item.path}/`)))
      .sort((a, b) => b.path.length - a.path.length)[0]?.label ?? "Panel";
  }, [pathname]);

  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("") || "RA";

  async function logout() {
    setLoggingOut(true);
    await fetch("/api/admin/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/admin/login");
    router.refresh();
  }

  function isActive(href: string) {
    const path = href.split("?")[0];
    return pathname === path || (path !== "/admin" && pathname.startsWith(`${path}/`));
  }

  function renderLinks(links: AdminLink[]) {
    return links.map((link) => (
      <Link key={link.href} href={link.href} className={isActive(link.href) ? "active" : ""} aria-current={isActive(link.href) ? "page" : undefined} onClick={() => setOpen(false)}>
        <AdminIcon name={link.icon} size={18} />
        <span>{link.label}</span>
      </Link>
    ));
  }

  return (
    <>
      <aside ref={sidebarRef} id="admin-menu" className={`admin-sidebar ${open ? "is-open" : ""}`} aria-label="Navegación">
        <button className="admin-sidebar-close" type="button" aria-label="Cerrar menú" onClick={() => setOpen(false)}>
          <AdminIcon name="close" size={20} />
        </button>

        <Link className="admin-sidebar-brand" href="/admin" onClick={() => setOpen(false)}>
          <Image src="/crm-logo.png" alt="" width={34} height={34} priority />
          <span><strong>R.A. Training</strong><small>CRM</small></span>
        </Link>

        <nav className="admin-sidebar-nav">
          <section className="admin-nav-group is-primary">{renderLinks(TRABAJO)}</section>
          <section className="admin-nav-group is-secondary">{renderLinks(GESTION_LINKS)}</section>
          {view === "tecnica" ? (
            <section className="admin-nav-group" aria-label="Sistema">
              <h2>Sistema</h2>
              {renderLinks(SISTEMA)}
            </section>
          ) : null}
        </nav>

        <div className="admin-sidebar-footer">
          <span className="admin-avatar" aria-hidden="true">{initials}</span>
          <span className="admin-sidebar-user">
            <strong>{name}</strong>
            <small>{legacy ? "Acceso temporal" : profileLabel(role)}</small>
          </span>
          <button type="button" onClick={logout} disabled={loggingOut} aria-label="Cerrar sesión" title="Cerrar sesión">
            <AdminIcon name="logout" size={17} />
          </button>
        </div>
      </aside>

      {open ? <button className="admin-sidebar-backdrop" type="button" aria-label="Cerrar menú" onClick={() => setOpen(false)} /> : null}

      <header className="admin-topbar">
        <div className="admin-topbar-start">
          <button
            ref={menuButtonRef}
            className="admin-menu-toggle"
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="admin-menu"
            aria-label={open ? "Cerrar menú" : "Abrir menú"}
          >
            <AdminIcon name={open ? "close" : "menu"} size={22} />
          </button>
          <strong className="admin-current-page">{currentPage}</strong>
        </div>

        <div className="admin-topbar-actions">
          {technical ? <ViewSwitch current={view} /> : null}
          <details className="admin-user-menu">
            <summary aria-label="Menú de usuario">
              <span className="admin-avatar" aria-hidden="true">{initials}</span>
              <AdminIcon name="chevron" size={15} />
            </summary>
            <div className="admin-user-popover">
              <div><strong>{name}</strong><span>{profileLabel(role)}</span></div>
              <a href="https://ra-training.com/courses-1/" target="_blank" rel="noopener noreferrer">
                <AdminIcon name="external" size={16} />
                Ver catálogo público
              </a>
              <button type="button" onClick={logout} disabled={loggingOut}>
                <AdminIcon name="logout" size={16} />
                {loggingOut ? "Cerrando…" : "Cerrar sesión"}
              </button>
            </div>
          </details>
        </div>
      </header>
    </>
  );
}
