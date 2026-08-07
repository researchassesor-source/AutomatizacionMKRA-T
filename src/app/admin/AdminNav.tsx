"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AdminIcon, type AdminIconName } from "./AdminIcon";
import { CONSULTA, CONTENIDO, GESTION, OPERACION, TECNICO, isTechnicalProfile, profileLabel } from "@/lib/auth/roles";
import { useTechnicalDetail } from "./TechnicalDetail";
import { useAdminSession } from "./AdminSession";

type AdminLink = {
  href: string;
  label: string;
  icon: AdminIconName;
  roles: readonly string[];
};

/**
 * Navegacion.
 *
 * De once destinos en cinco grupos a cinco destinos sin grupos, mas la sala de
 * maquinas para el perfil tecnico. Las secciones retiradas (seguimientos,
 * ventas, campanas, plantillas y envios a Finance) conservan su codigo, sus
 * datos y sus rutas: simplemente dejan de competir por la atencion hasta que
 * el negocio las necesite. Ninguna tenia un solo registro.
 */
const navigation: Array<{ label: string | null; links: AdminLink[] }> = [
  {
    label: null,
    links: [
      { href: "/admin", label: "Inicio", icon: "overview", roles: CONSULTA },
      { href: "/admin/leads", label: "Contactos", icon: "contacts", roles: CONSULTA },
      { href: "/admin/cursos", label: "Cursos", icon: "courses", roles: CONSULTA },
      { href: "/admin/mensajes", label: "Comunicaciones", icon: "messages", roles: OPERACION },
      { href: "/admin/redes", label: "Redes", icon: "social", roles: CONTENIDO },
    ],
  },
  {
    label: "Sistema",
    links: [
      { href: "/admin/usuarios", label: "Usuarios", icon: "users", roles: GESTION },
      { href: "/admin/automatizaciones", label: "Reglas y campañas", icon: "calendar", roles: TECNICO },
      { href: "/admin/certificados", label: "Envíos a Finance", icon: "finance", roles: TECNICO },
      { href: "/admin/auditoria", label: "Auditoría", icon: "audit", roles: TECNICO },
    ],
  },
];

const pageNames = navigation.flatMap((group) => group.links);

/**
 * Interruptor de detalle tecnico.
 *
 * Apagado, el perfil tecnico ve la aplicacion tal como la vera direccion. Es la
 * unica forma fiable de comprobar que lo que se entrega esta bien.
 */
function TechnicalDetailToggle() {
  const { enabled, toggle } = useTechnicalDetail();
  return (
    <button
      type="button"
      className={`admin-tech-toggle ${enabled ? "is-on" : ""}`}
      onClick={toggle}
      aria-pressed={enabled}
      title={enabled ? "Ocultar códigos, estados internos e identificadores" : "Mostrar códigos de error, estados internos e identificadores"}
    >
      <span className="admin-tech-toggle-track" aria-hidden="true"><span className="admin-tech-toggle-thumb" /></span>
      <span>Detalle técnico</span>
    </button>
  );
}

export function AdminNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { role, name, legacy } = useAdminSession();
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
    window.requestAnimationFrame(() => sidebarRef.current?.querySelector<HTMLElement>("button")?.focus());
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
      menuButton?.focus();
    };
  }, [open]);

  const currentPage = useMemo(() => {
    return pageNames
      .filter((item) => pathname === item.href || (item.href !== "/admin" && pathname.startsWith(`${item.href}/`)))
      .sort((a, b) => b.href.length - a.href.length)[0]?.label ?? "Administración";
  }, [pathname]);

  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "RA";

  async function logout() {
    setLoggingOut(true);
    await fetch("/api/admin/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/admin/login");
    router.refresh();
  }

  return (
    <>
      <aside ref={sidebarRef} id="admin-menu" className={`admin-sidebar ${open ? "is-open" : ""}`} aria-label="Navegación administrativa">
        <button className="admin-sidebar-close" type="button" aria-label="Cerrar menú" onClick={() => setOpen(false)}>
          <AdminIcon name="close" size={20} />
        </button>
        <Link className="admin-sidebar-brand" href="/admin" onClick={() => setOpen(false)}>
          <span className="admin-sidebar-brand-row">
            <Image src="/crm-logo.png" alt="" width={64} height={64} priority />
            <strong>R.A. Training</strong>
          </span>
          <span>Panel administrativo</span>
        </Link>

        <nav className="admin-sidebar-nav">
          {navigation.map((group) => {
            const allowedLinks = group.links.filter((link) => link.roles.includes(role));
            if (!allowedLinks.length) return null;
            return (
              <section
                className={`admin-nav-group ${group.label ? "" : "is-primary"}`}
                key={group.label ?? "principal"}
                aria-label={group.label ?? "Secciones principales"}
              >
                {group.label ? <h2>{group.label}</h2> : null}
                {allowedLinks.map((link) => {
                  const isActive = pathname === link.href || (link.href !== "/admin" && pathname.startsWith(`${link.href}/`));
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={isActive ? "active" : ""}
                      aria-current={isActive ? "page" : undefined}
                      onClick={() => setOpen(false)}
                    >
                      <AdminIcon name={link.icon} size={19} />
                      <span>{link.label}</span>
                    </Link>
                  );
                })}
              </section>
            );
          })}
        </nav>

        <div className="admin-sidebar-footer">
          <AdminIcon name="secure" size={18} />
          <span><strong>{legacy ? "Acceso heredado temporal" : "Sesión protegida"}</strong><small>{legacy ? "Crea y usa una cuenta individual" : "Acceso según tu perfil"}</small></span>
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
          <div className="admin-current-page">
            <span>Panel administrativo</span>
            <strong>{currentPage}</strong>
          </div>
        </div>

        <div className="admin-topbar-actions">
          {isTechnicalProfile(role) ? <TechnicalDetailToggle /> : null}
          <a className="admin-site-link" href="https://ra-training.com/courses-1/" target="_blank" rel="noopener noreferrer" aria-label="Ver catálogo oficial de R.A. Training">
            <AdminIcon name="external" size={17} />
            <span>Ver catálogo oficial</span>
          </a>
          <details className="admin-user-menu">
            <summary aria-label="Abrir menú de usuario">
              <span className="admin-avatar" aria-hidden="true">{initials}</span>
              <span className="admin-user-copy"><strong>{name}</strong><small>{profileLabel(role)}</small></span>
              <AdminIcon name="chevron" size={16} />
            </summary>
            <div className="admin-user-popover">
              <div><strong>{name}</strong><span>Perfil {profileLabel(role)}</span></div>
              <button type="button" onClick={logout} disabled={loggingOut}>
                <AdminIcon name="logout" size={17} />
                {loggingOut ? "Cerrando…" : "Cerrar sesión"}
              </button>
            </div>
          </details>
        </div>
      </header>
    </>
  );
}
