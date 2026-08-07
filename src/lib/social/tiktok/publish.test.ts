import { describe, expect, it } from "vitest";
import { resolveTikTokConfig } from "./config";
import {
  describePublishError,
  describePublishStatus,
  fetchCreatorInfo,
  fetchPublishStatus,
  initDirectPost,
  initDraftUpload,
  isTerminalStatus,
  validateDisclosure,
  validatePostCompliance,
} from "./publish";

const sandbox = resolveTikTokConfig({
  TIKTOK_MODE: "sandbox",
  TIKTOK_CLIENT_KEY: "k",
  TIKTOK_CLIENT_SECRET: "s",
  TIKTOK_REDIRECT_URI: "https://automatizacion-mkra-t2.vercel.app/api/integrations/tiktok/callback",
  TIKTOK_OAUTH_STATE_SECRET: "x".repeat(40),
  TIKTOK_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
});

function reply(payload: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify(payload), { status })) as unknown as typeof fetch;
}

describe("HTTP 200 no significa éxito", () => {
  it("trata error.code distinto de ok como fallo, aunque el HTTP sea 200", async () => {
    const result = await fetchPublishStatus("t", "p", reply({ error: { code: "invalid_param", log_id: "abc" } }));
    expect(result).toMatchObject({ ok: false, errorCode: "invalid_param", logId: "abc" });
  });

  it("acepta error.code === ok", async () => {
    const result = await fetchPublishStatus("t", "p", reply({ data: { status: "PROCESSING_UPLOAD" }, error: { code: "ok" } }));
    expect(result).toMatchObject({ ok: true });
  });

  it("no lanza ante un fallo de red", async () => {
    const failing = (async () => { throw new Error("sin red"); }) as unknown as typeof fetch;
    expect(await fetchCreatorInfo("t", failing)).toMatchObject({ ok: false, errorCode: "NETWORK_ERROR" });
  });
});

describe("Creator Info", () => {
  it("expone las opciones de privacidad y las interacciones deshabilitadas", async () => {
    const result = await fetchCreatorInfo("t", reply({
      data: {
        creator_nickname: "R.A. Training",
        creator_username: "ratraining",
        privacy_level_options: ["SELF_ONLY", "PUBLIC_TO_EVERYONE"],
        comment_disabled: true,
        duet_disabled: false,
        stitch_disabled: true,
        max_video_post_duration_sec: 600,
      },
    }));
    expect(result.ok && result.data).toMatchObject({
      nickname: "R.A. Training",
      username: "ratraining",
      commentDisabled: true,
      stitchDisabled: true,
      maxVideoDurationSec: 600,
    });
  });
});

describe("carga como borrador", () => {
  it("devuelve publish_id y upload_url", async () => {
    const result = await initDraftUpload("t", { source: "FILE_UPLOAD", videoSize: 27017, chunkSize: 27017, totalChunkCount: 1 },
      reply({ data: { publish_id: "v_inbox.123", upload_url: "https://upload.tiktokapis.com/x" } }));
    expect(result.ok && result.data).toMatchObject({ publishId: "v_inbox.123" });
  });

  it("envía los campos exactos de FILE_UPLOAD", async () => {
    let body = "";
    const spy = (async (_u: string, init: RequestInit) => { body = String(init.body); return new Response(JSON.stringify({ data: { publish_id: "p" } })); }) as unknown as typeof fetch;
    await initDraftUpload("t", { source: "FILE_UPLOAD", videoSize: 100, chunkSize: 100, totalChunkCount: 1 }, spy);
    expect(JSON.parse(body).source_info).toEqual({ source: "FILE_UPLOAD", video_size: 100, chunk_size: 100, total_chunk_count: 1 });
  });

  it("envía video_url en PULL_FROM_URL", async () => {
    let body = "";
    const spy = (async (_u: string, init: RequestInit) => { body = String(init.body); return new Response(JSON.stringify({ data: { publish_id: "p" } })); }) as unknown as typeof fetch;
    await initDraftUpload("t", { source: "PULL_FROM_URL", videoUrl: "https://crm.example.test/v.mp4" }, spy);
    expect(JSON.parse(body).source_info).toEqual({ source: "PULL_FROM_URL", video_url: "https://crm.example.test/v.mp4" });
  });

  it("rechaza una respuesta sin publish_id en lugar de inventarlo", async () => {
    expect(await initDraftUpload("t", { source: "FILE_UPLOAD", videoSize: 1, chunkSize: 1, totalChunkCount: 1 }, reply({ data: {} })))
      .toMatchObject({ ok: false, errorCode: "MISSING_PUBLISH_ID" });
  });

  it("traduce el dominio no verificado", async () => {
    const result = await initDraftUpload("t", { source: "PULL_FROM_URL", videoUrl: "https://x.test/v.mp4" },
      reply({ error: { code: "url_ownership_unverified" } }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("no está verificado");
  });
});

describe("cumplimiento antes de Direct Post", () => {
  const base = {
    title: "Prueba",
    privacyLevel: "SELF_ONLY",
    disableComment: false,
    disableDuet: false,
    disableStitch: false,
    brandContentToggle: false,
    brandOrganicToggle: false,
    consentAccepted: true,
  };
  const creator = { privacyOptions: ["SELF_ONLY"] };

  it("acepta una combinación válida en sandbox", () => {
    expect(validatePostCompliance(base, creator, sandbox)).toEqual([]);
  });

  it("exige elegir privacidad: no hay valor por defecto", () => {
    expect(validatePostCompliance({ ...base, privacyLevel: "" }, creator, sandbox)).toContain("PRIVACY_NOT_SELECTED");
  });

  it("rechaza un nivel no ofrecido por la cuenta", () => {
    expect(validatePostCompliance({ ...base, privacyLevel: "PUBLIC_TO_EVERYONE" }, creator, sandbox)).toContain("PRIVACY_NOT_ALLOWED");
  });

  it("impide contenido de marca en privado", () => {
    // La guía oficial lo prohíbe explícitamente.
    expect(validatePostCompliance({ ...base, brandContentToggle: true, privacyLevel: "SELF_ONLY" }, creator, sandbox))
      .toContain("BRANDED_CONTENT_REQUIRES_PUBLIC");
  });

  it("exige consentimiento explícito", () => {
    expect(validatePostCompliance({ ...base, consentAccepted: false }, creator, sandbox)).toContain("CONSENT_MISSING");
  });

  it("exige elegir modalidad si la divulgación está activada", () => {
    expect(validateDisclosure(true, false, false)).toEqual(["DISCLOSURE_WITHOUT_SELECTION"]);
    expect(validateDisclosure(true, true, false)).toEqual([]);
    expect(validateDisclosure(false, false, false)).toEqual([]);
  });

  it("Direct Post envía los campos de post_info documentados", async () => {
    let body = "";
    const spy = (async (_u: string, init: RequestInit) => { body = String(init.body); return new Response(JSON.stringify({ data: { publish_id: "p" } })); }) as unknown as typeof fetch;
    await initDirectPost("t", { source: "PULL_FROM_URL", videoUrl: "https://x.test/v.mp4" }, { ...base, title: "Hola" }, spy);
    expect(JSON.parse(body).post_info).toMatchObject({
      title: "Hola",
      privacy_level: "SELF_ONLY",
      disable_comment: false,
      brand_content_toggle: false,
      brand_organic_toggle: false,
    });
  });
});

describe("estado de la publicación", () => {
  it("distingue estados terminales de intermedios", () => {
    expect(isTerminalStatus("PUBLISH_COMPLETE")).toBe(true);
    expect(isTerminalStatus("FAILED")).toBe(true);
    expect(isTerminalStatus("PROCESSING_UPLOAD")).toBe(false);
    expect(isTerminalStatus("SEND_TO_USER_INBOX")).toBe(false);
  });

  it("conserva el motivo del fallo", async () => {
    const result = await fetchPublishStatus("t", "p", reply({ data: { status: "FAILED", fail_reason: "picture_size_check_failed" } }));
    expect(result.ok && result.data).toMatchObject({ status: "FAILED", failReason: "picture_size_check_failed" });
  });

  it("acepta ambas grafías del campo de post público", async () => {
    const conErrata = await fetchPublishStatus("t", "p", reply({ data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: ["123"] } }));
    const correcta = await fetchPublishStatus("t", "p", reply({ data: { status: "PUBLISH_COMPLETE", publicly_available_post_id: ["456"] } }));
    expect(conErrata.ok && conErrata.data.publiclyAvailablePostId).toBe("123");
    expect(correcta.ok && correcta.data.publiclyAvailablePostId).toBe("456");
  });

  it("explica el borrador en la bandeja", () => {
    expect(describePublishStatus("SEND_TO_USER_INBOX")).toContain("Termina la publicación desde la aplicación");
  });

  it("traduce el bloqueo de cliente sin auditar", () => {
    expect(describePublishError("unaudited_client_can_only_post_to_private_accounts")).toContain("privadas");
  });
});
