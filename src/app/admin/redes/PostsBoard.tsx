"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatMoment, relativeMoment } from "@/lib/message-presentation";
import { useFeedback } from "../Feedback";

export type BoardPost = {
  id: string;
  caption: string;
  mediaUrl: string | null;
  linkUrl: string | null;
  status: string;
  platform: string;
  accountName: string;
  scheduledAt: string | null;
  error: string | null;
  providerPostUrl: string | null;
};

const PESTANAS: ReadonlyArray<{ key: "programadas" | "publicadas" | "fallidas"; label: string; estados: readonly string[] }> = [
  { key: "programadas", label: "Programadas", estados: ["PROGRAMADO", "BORRADOR"] },
  { key: "publicadas", label: "Publicadas", estados: ["PUBLICADO", "ACEPTADO", "SIMULADO"] },
  { key: "fallidas", label: "No salieron", estados: ["FALLIDO", "CANCELADO"] },
];

/**
 * Publicaciones agrupadas por lo que le importa a quien las revisa: lo que
 * esta por salir, lo que ya salio y lo que fallo. El estado interno del
 * proveedor no aporta nada en esta pantalla.
 */
export function PostsBoard({ posts }: { posts: BoardPost[] }) {
  const router = useRouter();
  const { toast, confirm } = useFeedback();
  const [pestana, setPestana] = useState<"programadas" | "publicadas" | "fallidas">("programadas");
  const [busy, setBusy] = useState<string | null>(null);

  const activa = PESTANAS.find((item) => item.key === pestana) ?? PESTANAS[0];
  const visibles = posts.filter((post) => activa.estados.includes(post.status));

  async function accion(post: BoardPost, action: "publish" | "retry" | "cancel" | "duplicate") {
    if (action === "cancel") {
      const ok = await confirm({
        title: "Cancelar esta publicación",
        body: "No se enviará a la red. Podrás duplicarla más adelante si cambias de idea.",
        confirmLabel: "Cancelar publicación",
        tone: "danger",
      });
      if (!ok) return;
    }
    setBusy(post.id);
    const response = await fetch(`/api/admin/social/posts/${post.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, confirm: true }),
    });
    const result = await response.json().catch(() => ({}));
    setBusy(null);
    if (!response.ok) {
      toast({ tone: "error", title: "No se pudo completar", detail: result.error ?? "Inténtalo de nuevo." });
      return;
    }
    const titulos: Record<string, string> = {
      publish: "Publicación enviada",
      retry: "Se reintentó la publicación",
      cancel: "Publicación cancelada",
      duplicate: "Copia creada como borrador",
    };
    toast({ tone: "success", title: titulos[action] });
    router.refresh();
  }

  return (
    <section className="panel">
      <h2>Publicaciones</h2>

      <nav className="tabs" aria-label="Estado de las publicaciones">
        {PESTANAS.map((item) => {
          const total = posts.filter((post) => item.estados.includes(post.status)).length;
          return (
            <button
              type="button"
              key={item.key}
              className={pestana === item.key ? "is-active" : ""}
              onClick={() => setPestana(item.key)}
              aria-pressed={pestana === item.key}
            >
              {item.label} {total > 0 ? <span className="tab-count">{total}</span> : null}
            </button>
          );
        })}
      </nav>

      {visibles.length === 0 ? (
        <p className="muted">
          {pestana === "programadas" ? "No hay nada esperando salir." : pestana === "publicadas" ? "Todavía no se ha publicado nada." : "Ninguna publicación ha fallado."}
        </p>
      ) : (
        <div className="post-list">
          {visibles.map((post) => (
            <article className="post-row" key={post.id}>
              {post.mediaUrl ? <span className="post-thumb" style={{ backgroundImage: `url(${post.mediaUrl})` }} aria-hidden="true" /> : null}
              <div className="post-main">
                <span className="post-network">{nombreRed(post.platform)}</span>
                <p>{post.caption.slice(0, 160)}{post.caption.length > 160 ? "…" : ""}</p>
                <small>
                  {post.scheduledAt ? `${formatMoment(post.scheduledAt)} · ${relativeMoment(post.scheduledAt)}` : "Sin fecha"}
                  {post.error ? ` · ${post.error.slice(0, 90)}` : ""}
                </small>
              </div>
              <div className="post-actions">
                {post.providerPostUrl ? (
                  <a className="btn-sm ghost" href={post.providerPostUrl} target="_blank" rel="noreferrer">Ver publicada ↗</a>
                ) : null}
                {activa.key === "programadas" ? (
                  <>
                    <button type="button" className="btn-sm" disabled={busy === post.id} onClick={() => accion(post, "publish")}>Publicar ahora</button>
                    <button type="button" className="btn-sm ghost" disabled={busy === post.id} onClick={() => accion(post, "cancel")}>Cancelar</button>
                  </>
                ) : null}
                {activa.key === "fallidas" ? (
                  <>
                    <button type="button" className="btn-sm" disabled={busy === post.id} onClick={() => accion(post, "retry")}>Reintentar</button>
                    <button type="button" className="btn-sm ghost" disabled={busy === post.id} onClick={() => accion(post, "duplicate")}>Duplicar</button>
                  </>
                ) : null}
                {activa.key === "publicadas" ? (
                  <button type="button" className="btn-sm ghost" disabled={busy === post.id} onClick={() => accion(post, "duplicate")}>Volver a usar</button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function nombreRed(platform: string): string {
  return platform === "INSTAGRAM" ? "Instagram" : platform === "FACEBOOK" ? "Facebook" : "TikTok";
}
