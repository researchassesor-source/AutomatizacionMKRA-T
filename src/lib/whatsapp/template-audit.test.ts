import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { WHATSAPP_TEMPLATES } from "./templates";
import {
  auditarPlantillasConMeta,
  compararCatalogo,
  compararPlantilla,
  descargarPlantillasDeMeta,
  resolverConfigAuditoria,
  type MetaTemplate,
} from "./template-audit";

/**
 * Auditoria de plantillas contra Meta.
 *
 * La comparacion tiene que fallar en rojo ante cualquier contrato que
 * produciria un rechazo real: si aqui algo pasa en verde y luego Meta lo
 * rechaza, la auditoria seria peor que no tenerla, porque daria confianza.
 */
const TOKEN = "token-de-prueba-no-real";
const ENV = { WHATSAPP_ACCESS_TOKEN: TOKEN, WHATSAPP_WABA_ID: "waba-123", WHATSAPP_GRAPH_API_VERSION: "v25.0" };

/** Una plantilla de Meta que coincide con lo que declara el codigo. */
function remotaDe(clave: keyof typeof WHATSAPP_TEMPLATES, extra: Partial<MetaTemplate> = {}): MetaTemplate {
  const spec = WHATSAPP_TEMPLATES[clave];
  const cuerpo = spec.bodyVars.map((_, i) => `{{${i + 1}}}`).join(" ");
  return {
    name: spec.name,
    language: spec.language,
    status: "APPROVED",
    category: "UTILITY",
    parameter_format: "POSITIONAL",
    components: [{ type: "BODY", text: `Hola ${cuerpo}` }],
    ...extra,
  };
}

/** Catalogo remoto completo y correcto: las 12 tal como las declara el codigo. */
function todasCorrectas(): MetaTemplate[] {
  return (Object.keys(WHATSAPP_TEMPLATES) as Array<keyof typeof WHATSAPP_TEMPLATES>).map((clave) => remotaDe(clave));
}

function respuesta(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response;
}

const BIENVENIDA = "welcome" as const;
const spec = WHATSAPP_TEMPLATES[BIENVENIDA];

describe("configuración", () => {
  it("dice qué falta cuando no hay token, sin inventar nada", () => {
    const r = resolverConfigAuditoria({ WHATSAPP_WABA_ID: "waba-123" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errorCode).toBe("WHATSAPP_TOKEN_MISSING");
  });

  it("distingue el identificador de la cuenta del identificador del número", () => {
    const r = resolverConfigAuditoria({ WHATSAPP_ACCESS_TOKEN: TOKEN, WHATSAPP_PHONE_NUMBER_ID: "123" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errorCode).toBe("WHATSAPP_WABA_MISSING");
    expect(r.error).toContain("cuenta de WhatsApp Business");
  });

  it("el error de configuración no contiene el token", () => {
    const r = resolverConfigAuditoria({ WHATSAPP_ACCESS_TOKEN: TOKEN });
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });
});

describe("lectura de Meta", () => {
  it("solo usa GET y manda el token en la cabecera, nunca en la URL", async () => {
    const fetchMock = vi.fn(async () => respuesta({ data: todasCorrectas() }));
    await descargarPlantillasDeMeta({ accessToken: TOKEN, wabaId: "waba-123", graphVersion: "v25.0" }, fetchMock as unknown as typeof fetch);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("GET");
    expect(url).not.toContain(TOKEN);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("nunca toca el endpoint de mensajes", async () => {
    const fetchMock = vi.fn(async () => respuesta({ data: todasCorrectas() }));
    await auditarPlantillasConMeta(ENV, fetchMock as unknown as typeof fetch);
    for (const [url] of fetchMock.mock.calls as unknown as Array<[string]>) {
      expect(url).toContain("/message_templates");
      expect(url).not.toContain("/messages");
    }
  });

  it("sigue la paginación hasta agotarla", async () => {
    const paginas = [
      respuesta({ data: [remotaDe(BIENVENIDA)], paging: { next: "https://graph.facebook.com/siguiente" } }),
      respuesta({ data: [remotaDe("thank_you")] }),
    ];
    const fetchMock = vi.fn(async () => paginas.shift() ?? respuesta({ data: [] }));
    const r = await descargarPlantillasDeMeta({ accessToken: TOKEN, wabaId: "w", graphVersion: "v25.0" }, fetchMock as unknown as typeof fetch);
    expect(r.ok && r.plantillas).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("un error de Meta se devuelve legible y sin el token", async () => {
    const fetchMock = vi.fn(async () => respuesta({ error: { code: 190, message: "Invalid OAuth access token." } }, false, 401));
    const r = await auditarPlantillasConMeta(ENV, fetchMock as unknown as typeof fetch);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errorCode).toBe("META_190");
    expect(r.error).toContain("Invalid OAuth");
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });

  it("si Meta no responde, lo dice en lugar de romperse", async () => {
    const fetchMock = vi.fn(async () => { throw new Error("network"); });
    const r = await auditarPlantillasConMeta(ENV, fetchMock as unknown as typeof fetch);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errorCode).toBe("META_UNREACHABLE");
  });
});

describe("semáforo", () => {
  it("las 12 coincidiendo y aprobadas dan GREEN", async () => {
    const fetchMock = vi.fn(async () => respuesta({ data: todasCorrectas() }));
    const r = await auditarPlantillasConMeta(ENV, fetchMock as unknown as typeof fetch);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.green).toBe(12);
    expect(r.red).toBe(0);
    expect(r.total).toBe(12);
  });

  it("4 en el CRM contra 3 en Meta da RED y nombra ambos números", () => {
    const remota = remotaDe(BIENVENIDA, { components: [{ type: "BODY", text: "Hola {{1}} {{2}} {{3}}" }] });
    const fila = compararPlantilla(BIENVENIDA, spec, [remota]);
    expect(fila.result).toBe("RED");
    expect(fila.meta?.bodyParams).toBe(3);
    expect(fila.codigo.bodyParams).toBe(4);
    expect(fila.detail).toContain("Meta espera 3");
    expect(fila.detail).toContain("CRM envía 4");
  });

  it("una cabecera con variable da RED: el CRM no envía cabecera", () => {
    const remota = remotaDe(BIENVENIDA);
    remota.components = [...(remota.components ?? []), { type: "HEADER", text: "Curso {{1}}" }];
    const fila = compararPlantilla(BIENVENIDA, spec, [remota]);
    expect(fila.result).toBe("RED");
    expect(fila.meta?.headerParams).toBe(1);
    expect(fila.detail).toContain("HEADER");
  });

  it("una cabecera de texto fijo no rompe nada", () => {
    const remota = remotaDe(BIENVENIDA);
    remota.components = [...(remota.components ?? []), { type: "HEADER", text: "R.A. Training" }];
    expect(compararPlantilla(BIENVENIDA, spec, [remota]).result).toBe("GREEN");
  });

  it("un botón con URL variable que el código no declara da RED", () => {
    const remota = remotaDe(BIENVENIDA);
    remota.components = [...(remota.components ?? []), { type: "BUTTONS", buttons: [{ url: "https://ra-training.com/{{1}}" }] }];
    const fila = compararPlantilla(BIENVENIDA, spec, [remota]);
    expect(fila.result).toBe("RED");
    expect(fila.meta?.buttonParams).toBe(1);
    expect(fila.detail).toContain("BUTTON");
  });

  it("un botón de URL fija no cuenta como parámetro", () => {
    const remota = remotaDe(BIENVENIDA);
    remota.components = [...(remota.components ?? []), { type: "BUTTONS", buttons: [{ url: "https://ra-training.com/cursos" }] }];
    expect(compararPlantilla(BIENVENIDA, spec, [remota]).result).toBe("GREEN");
  });

  it("otro idioma da RED y lo dice, en vez de «no existe»", () => {
    const remota = remotaDe(BIENVENIDA, { language: "es_MX" });
    const fila = compararPlantilla(BIENVENIDA, spec, [remota]);
    expect(fila.result).toBe("RED");
    expect(fila.detail).toContain("es_MX");
  });

  it("no existir en Meta da RED", () => {
    const fila = compararPlantilla(BIENVENIDA, spec, []);
    expect(fila.result).toBe("RED");
    expect(fila.meta).toBeNull();
    expect(fila.detail).toBe("No existe en Meta.");
  });

  it("parámetros con nombre dan RED aunque el número coincida", () => {
    // Es el caso traicionero: cuatro variables en ambos lados, y aun asi Meta
    // rechaza el envio entero porque el formato no es el mismo.
    const remota = remotaDe(BIENVENIDA, {
      parameter_format: "NAMED",
      components: [{ type: "BODY", text: "Hola {{nombre}} {{curso}} {{fecha}} {{hora}}" }],
    });
    const fila = compararPlantilla(BIENVENIDA, spec, [remota]);
    expect(fila.result).toBe("RED");
    expect(fila.detail).toContain("con nombre");
  });

  it("contrato correcto pero pendiente de aprobación da YELLOW", () => {
    const fila = compararPlantilla(BIENVENIDA, spec, [remotaDe(BIENVENIDA, { status: "PENDING" })]);
    expect(fila.result).toBe("YELLOW");
    expect(fila.detail).toContain("PENDING");
  });

  it("rechazada da RED aunque el contrato coincida: un envío real fallaría", () => {
    const fila = compararPlantilla(BIENVENIDA, spec, [remotaDe(BIENVENIDA, { status: "REJECTED" })]);
    expect(fila.result).toBe("RED");
  });

  it("el resumen cuenta las 12 y suma exactamente", () => {
    const remotas = todasCorrectas().filter((t) => t.name !== spec.name);
    const r = compararCatalogo(remotas);
    expect(r.total).toBe(12);
    expect(r.green + r.yellow + r.red).toBe(12);
    expect(r.red).toBe(1);
  });
});

describe("el endpoint del panel", () => {
  const ruta = readFileSync(join(process.cwd(), "src/app/api/admin/whatsapp/templates-audit/route.ts"), "utf8");

  it("exige sesión con rol técnico", () => {
    expect(ruta).toContain("requireRole(request, TECNICO)");
  });

  it("solo expone GET: no hay forma de escribir desde esta ruta", () => {
    expect(ruta).toContain("export async function GET");
    expect(ruta).not.toMatch(/export async function (POST|PUT|PATCH|DELETE)/);
  });

  it("nunca devuelve el token ni ningún otro secreto", () => {
    // Se mira lo que se responde, no el archivo entero: un comentario puede
    // nombrar la cabecera precisamente para explicar que no se devuelve.
    const respuestas = ruta.split("NextResponse.json").slice(1).join(" · ");
    expect(respuestas).not.toMatch(/accessToken|appSecret|verifyToken|Authorization|Bearer/);
  });

  it("no lee el token: se lo deja al helper", () => {
    expect(ruta).not.toContain("WHATSAPP_ACCESS_TOKEN");
  });
});
