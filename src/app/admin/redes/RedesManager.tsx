"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Account = { id: string; platform: string; displayName: string };
type Post = {
  id: string;
  caption: string;
  status: string;
  account: string;
  scheduledAt: string | null;
  error: string | null;
};

const PLATFORMS = ["INSTAGRAM", "FACEBOOK", "TIKTOK", "YOUTUBE", "LINKEDIN"];

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, data: await res.json() };
}

export function RedesManager({
  accounts,
  posts,
}: {
  accounts: Account[];
  posts: Post[];
}) {
  const router = useRouter();
  const [testPlatform, setTestPlatform] = useState("INSTAGRAM");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [mediaUrl, setMediaUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setUploadMsg(`✗ ${data.error ?? "no se pudo subir"}`);
      } else {
        setMediaUrl(data.url);
        setUploadMsg("✓ Imagen lista");
      }
    } catch {
      setUploadMsg("✗ error de conexion");
    } finally {
      setUploading(false);
    }
  }

  async function testConnection() {
    setBusy("test");
    setTestResult(null);
    const { data } = await postJson("/api/admin/social/test", {
      platform: testPlatform,
    });
    setTestResult(
      data.ok
        ? `✓ Conectado como ${data.name ?? "cuenta"}`
        : `✗ ${data.error ?? "fallo"}`,
    );
    setBusy(null);
  }

  async function registerAccount(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy("account");
    const f = new FormData(e.currentTarget);
    const { ok } = await postJson("/api/admin/social/accounts", {
      platform: f.get("platform"),
      displayName: f.get("displayName"),
      externalId: f.get("externalId") || undefined,
    });
    setBusy(null);
    if (ok) {
      (e.target as HTMLFormElement).reset();
      router.refresh();
    }
  }

  async function createPost(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy("post");
    const f = new FormData(e.currentTarget);
    const scheduledAtRaw = String(f.get("scheduledAt") ?? "");
    const { ok, data } = await postJson("/api/admin/social/posts", {
      accountId: f.get("accountId"),
      caption: f.get("caption"),
      mediaUrl: mediaUrl || f.get("mediaUrl") || "",
      linkUrl: f.get("linkUrl") || "",
      scheduledAt: scheduledAtRaw
        ? new Date(scheduledAtRaw).toISOString()
        : "",
    });
    setBusy(null);
    if (ok) {
      (e.target as HTMLFormElement).reset();
      setMediaUrl("");
      setUploadMsg(null);
      router.refresh();
    } else {
      alert(data.error ?? "Error al crear el post");
    }
  }

  async function publishNow(postId: string) {
    setBusy(postId);
    const { data } = await postJson("/api/admin/social/publish", { postId });
    setBusy(null);
    if (!data.ok) alert(`No se pudo publicar: ${data.error ?? "error"}`);
    router.refresh();
  }

  return (
    <>
      {/* Probar conexion */}
      <div className="panel">
        <h2>1 · Conectar Meta (Instagram / Facebook)</h2>
        <p className="muted" style={{ marginTop: -6 }}>
          Configura las credenciales en el archivo <code>.env</code> y prueba la
          conexion antes de publicar.
        </p>
        <div className="form-row" style={{ maxWidth: 460 }}>
          <select
            value={testPlatform}
            onChange={(e) => setTestPlatform(e.target.value)}
          >
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <button
            className="btn-sm"
            onClick={testConnection}
            disabled={busy === "test"}
          >
            {busy === "test" ? "Probando..." : "Probar conexion"}
          </button>
        </div>
        {testResult && <div className="result-line">{testResult}</div>}
      </div>

      {/* Registrar cuenta */}
      <div className="panel">
        <h2>2 · Registrar cuenta</h2>
        <form onSubmit={registerAccount}>
          <div className="form-row">
            <select name="platform" defaultValue="INSTAGRAM">
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <input name="displayName" placeholder="Nombre visible" required />
            <input name="externalId" placeholder="ID externo (opcional)" />
          </div>
          <button className="btn-sm" type="submit" disabled={busy === "account"}>
            {busy === "account" ? "Guardando..." : "Guardar cuenta"}
          </button>
        </form>

        {accounts.length > 0 && (
          <div className="table-wrap" style={{ marginTop: 16 }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Plataforma</th>
                  <th>Nombre</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <span className="pill">{a.platform}</span>
                    </td>
                    <td>{a.displayName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Crear publicacion */}
      <div className="panel">
        <h2>3 · Nueva publicacion</h2>
        {accounts.length === 0 ? (
          <p className="muted">Registra una cuenta primero.</p>
        ) : (
          <form onSubmit={createPost}>
            <div className="form-row">
              <select name="accountId" required>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.platform} · {a.displayName}
                  </option>
                ))}
              </select>
              <input name="linkUrl" placeholder="URL de enlace (opcional)" />
              <input
                name="scheduledAt"
                type="datetime-local"
                title="Dejar vacio = borrador"
              />
            </div>

            {/* Imagen: subir desde el equipo o pegar una URL */}
            <div className="form-row" style={{ alignItems: "center" }}>
              <label className="btn-sm ghost" style={{ cursor: "pointer", textAlign: "center" }}>
                {uploading ? "Subiendo..." : "📷 Subir imagen"}
                <input
                  type="file"
                  accept="image/jpeg,image/png"
                  onChange={handleUpload}
                  disabled={uploading}
                  style={{ display: "none" }}
                />
              </label>
              <input
                name="mediaUrl"
                placeholder="...o pega la URL de la imagen"
                value={mediaUrl}
                onChange={(e) => setMediaUrl(e.target.value)}
              />
              {uploadMsg && <span className="result-line">{uploadMsg}</span>}
            </div>
            {mediaUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={mediaUrl}
                alt="vista previa"
                style={{ maxHeight: 90, borderRadius: 8, margin: "4px 0 12px" }}
              />
            )}
            <div className="form-row" style={{ gridTemplateColumns: "1fr" }}>
              <textarea
                name="caption"
                placeholder="Texto de la publicacion..."
                rows={3}
                required
              />
            </div>
            <button className="btn-sm" type="submit" disabled={busy === "post"}>
              {busy === "post" ? "Creando..." : "Crear publicacion"}
            </button>
            <span className="muted" style={{ marginLeft: 10 }}>
              Sin fecha = borrador · con fecha = programado
            </span>
          </form>
        )}
      </div>

      {/* Lista de posts */}
      <div className="panel">
        <h2>Publicaciones</h2>
        {posts.length === 0 ? (
          <p className="muted">Sin publicaciones aun.</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Cuenta</th>
                  <th>Texto</th>
                  <th>Estado</th>
                  <th>Programado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {posts.map((p) => (
                  <tr key={p.id}>
                    <td>{p.account}</td>
                    <td style={{ maxWidth: 280 }}>{p.caption}</td>
                    <td>
                      <span
                        className={`pill ${
                          p.status === "PUBLICADO"
                            ? "ok"
                            : p.status === "FALLIDO"
                              ? "err"
                              : p.status === "PROGRAMADO"
                                ? "warn"
                                : ""
                        }`}
                      >
                        {p.status}
                      </span>
                      {p.error && <div className="muted">{p.error}</div>}
                    </td>
                    <td>
                      {p.scheduledAt
                        ? new Date(p.scheduledAt).toLocaleString("es", {
                            dateStyle: "short",
                            timeStyle: "short",
                          })
                        : "—"}
                    </td>
                    <td>
                      {p.status !== "PUBLICADO" && (
                        <button
                          className="btn-sm ghost"
                          onClick={() => publishNow(p.id)}
                          disabled={busy === p.id}
                        >
                          {busy === p.id ? "..." : "Publicar ya"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
