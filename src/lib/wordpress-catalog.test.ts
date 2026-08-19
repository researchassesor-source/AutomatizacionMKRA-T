import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchWordPressCourses,
  isPlaceholderWordPressCourse,
  normalizeWordPressCourse,
  resolveWordPressCourseMapping,
  safeWordPressErrorCode,
  WORDPRESS_CRM_SLUG_BY_ID,
  type CourseIdentity,
  type WordPressCourse,
} from "./wordpress-catalog";

afterEach(() => vi.unstubAllEnvs());

describe("catálogo WordPress de solo lectura", () => {
  const source = { id: 81, slug: "curso-oficial", link: "https://ra-training.com/cursos/curso-oficial/", modified_gmt: "2026-08-03T12:30:00", status: "publish", title: { rendered: "Curso &amp; Taller" }, acf: { crm_slug: "curso-crm" } };

  it("normaliza ID externo, slug oficial y crmSlug explícito", () => {
    expect(normalizeWordPressCourse(source)).toMatchObject({ externalId: "81", officialSlug: "curso-oficial", crmSlug: "curso-crm", title: "Curso & Taller", sourceStatus: "publish" });
    expect(normalizeWordPressCourse({ ...source, acf: [] }).crmSlug).toBeNull();
  });

  it("exige endpoint HTTPS y solo ejecuta GET", async () => {
    vi.stubEnv("WORDPRESS_COURSES_API_URL", "https://ra-training.com/wp-json/wp/v2/cursos?per_page=100");
    const fetcher = vi.fn(async (_url: URL, _init: RequestInit) => new Response(JSON.stringify([source]), { status: 200, headers: { "x-wp-totalpages": "1", "x-wp-total": "1" } }));
    await expect(fetchWordPressCourses(fetcher as typeof fetch)).resolves.toHaveLength(1);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe("GET");
  });

  it("se detiene ante IDs externos duplicados", async () => {
    vi.stubEnv("WORDPRESS_COURSES_API_URL", "https://ra-training.com/wp-json/wp/v2/cursos?per_page=100");
    const fetcher = vi.fn(async () => new Response(JSON.stringify([source, source]), { status: 200, headers: { "x-wp-total": "2" } }));
    await expect(fetchWordPressCourses(fetcher as typeof fetch)).rejects.toThrow("DUPLICATE_EXTERNAL_ID");
  });

  it("no expone detalles de configuración en los errores", () => {
    expect(safeWordPressErrorCode(new Error("Invalid URL containing a private value"))).toBe("WORDPRESS_SYNC_FAILED");
    expect(safeWordPressErrorCode(new Error("WORDPRESS_API_HTTP_403"))).toBe("WORDPRESS_API_HTTP_403");
  });

  it("rechaza endpoints HTTPS ajenos o de otro tipo de contenido", async () => {
    vi.stubEnv("WORDPRESS_COURSES_API_URL", "https://example.com/wp-json/wp/v2/cursos");
    await expect(fetchWordPressCourses()).rejects.toThrow("WORDPRESS_API_ENDPOINT_NOT_ALLOWED");
  });
});

/**
 * Riesgo confirmado: una respuesta 200 parcial (una pagina que fallo entre
 * medias, un proxy que corto la lista) no lanzaba ningun error. Sin verificar
 * X-WP-Total, reconcileCatalogAndAutomations trataria a los cursos que
 * faltaron como si ya no existieran en el sitio y los marcaria HISTORICAL.
 */
describe("integridad del catálogo: X-WP-Total antes de reconciliar nada", () => {
  function curso(id: number) {
    return { id, slug: `curso-${id}`, link: `https://ra-training.com/cursos/curso-${id}/`, modified_gmt: "2026-08-03T12:30:00", status: "publish", title: { rendered: `Curso ${id}` } };
  }

  beforeEach(() => vi.stubEnv("WORDPRESS_COURSES_API_URL", "https://ra-training.com/wp-json/wp/v2/cursos?per_page=100"));

  it("1: X-WP-Total dice 16 pero la página solo trae 8 -> WORDPRESS_API_INCOMPLETE_CATALOG", async () => {
    const ocho = Array.from({ length: 8 }, (_, i) => curso(i + 1));
    const fetcher = vi.fn(async () => new Response(JSON.stringify(ocho), { status: 200, headers: { "x-wp-totalpages": "1", "x-wp-total": "16" } }));
    await expect(fetchWordPressCourses(fetcher as typeof fetch)).rejects.toThrow("WORDPRESS_API_INCOMPLETE_CATALOG");
  });

  it("2a: sin cabecera X-WP-Total -> fail closed", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify([curso(1)]), { status: 200, headers: { "x-wp-totalpages": "1" } }));
    await expect(fetchWordPressCourses(fetcher as typeof fetch)).rejects.toThrow("WORDPRESS_API_INCOMPLETE_CATALOG");
  });

  it("2b: X-WP-Total no numérico -> fail closed", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify([curso(1)]), { status: 200, headers: { "x-wp-totalpages": "1", "x-wp-total": "dieciséis" } }));
    await expect(fetchWordPressCourses(fetcher as typeof fetch)).rejects.toThrow("WORDPRESS_API_INCOMPLETE_CATALOG");
  });

  it("2c: X-WP-Total cambia entre páginas -> fail closed", async () => {
    let page = 0;
    const fetcher = vi.fn(async () => {
      page++;
      const total = page === 1 ? "16" : "15";
      return new Response(JSON.stringify(Array.from({ length: 8 }, (_, i) => curso(page * 100 + i))), { status: 200, headers: { "x-wp-totalpages": "2", "x-wp-total": total } });
    });
    await expect(fetchWordPressCourses(fetcher as typeof fetch)).rejects.toThrow("WORDPRESS_API_INCOMPLETE_CATALOG");
  });

  it("3: X-WP-Total = 0 -> WORDPRESS_API_EMPTY_CATALOG, nunca se interpreta como borrar/historizar todo", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify([]), { status: 200, headers: { "x-wp-totalpages": "1", "x-wp-total": "0" } }));
    await expect(fetchWordPressCourses(fetcher as typeof fetch)).rejects.toThrow("WORDPRESS_API_EMPTY_CATALOG");
  });

  it("8: respuesta multi-página completa y consistente se acepta con normalidad", async () => {
    let page = 0;
    const fetcher = vi.fn(async () => {
      page++;
      const items = page === 1 ? Array.from({ length: 10 }, (_, i) => curso(i + 1)) : Array.from({ length: 6 }, (_, i) => curso(10 + i + 1));
      return new Response(JSON.stringify(items), { status: 200, headers: { "x-wp-totalpages": "2", "x-wp-total": "16" } });
    });
    await expect(fetchWordPressCourses(fetcher as typeof fetch)).resolves.toHaveLength(16);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("mapeo explícito WordPress → CRM", () => {
  const identities: CourseIdentity[] = Object.entries(WORDPRESS_CRM_SLUG_BY_ID).map(([externalId, slug]) => ({
    id: `course-${externalId}`,
    slug,
    crmSlug: slug,
    externalId: null,
    externalSource: null,
  }));

  function wordpress(externalId: string, officialSlug = `oficial-${externalId}`, title = `Curso ${externalId}`): WordPressCourse {
    return {
      externalId,
      officialSlug,
      officialUrl: `https://ra-training.com/cursos/${officialSlug}/`,
      title,
      crmSlug: null,
      sourceUpdatedAt: new Date("2026-08-03T12:30:00.000Z"),
      sourceStatus: "publish",
    };
  }

  it("reconoce los nueve IDs autorizados sin aproximación", () => {
    for (const [externalId, slug] of Object.entries(WORDPRESS_CRM_SLUG_BY_ID)) {
      expect(resolveWordPressCourseMapping(wordpress(externalId), identities)).toEqual({
        kind: "link",
        courseId: `course-${externalId}`,
        crmSlug: slug,
      });
    }
  });

  it("prioriza externalId ya persistido en sincronizaciones posteriores", () => {
    const linked = { ...identities[0], externalId: "9000", externalSource: "wordpress" };
    expect(resolveWordPressCourseMapping(wordpress("9000", "slug-renombrado"), [linked])).toMatchObject({ kind: "link", courseId: linked.id });
  });

  it("permite coincidencia exacta por slug y creación segura, nunca similitud aproximada", () => {
    const exact = { id: "exact", slug: "curso-exacto", crmSlug: null, externalId: null, externalSource: null };
    expect(resolveWordPressCourseMapping(wordpress("9001", "curso-exacto"), [exact])).toMatchObject({ kind: "link", courseId: "exact" });
    expect(resolveWordPressCourseMapping(wordpress("9002", "curso-nuevo"), [])).toEqual({ kind: "create", crmSlug: "curso-nuevo" });
    expect(resolveWordPressCourseMapping(wordpress("9003", "curso-exact"), [exact])).toEqual({ kind: "create", crmSlug: "curso-exact" });
  });

  it("ignora los tres placeholders en lugar de tratarlos como conflictos", () => {
    // Son páginas genéricas del sitio, no cursos: no deben crear, actualizar,
    // vincular ni aparecer como conflicto.
    for (const [externalId, slug] of [["2238", "proximamente"], ["2290", "proximamente-2"], ["2295", "proximamente-3"]]) {
      const course = wordpress(externalId, slug, "Próximamente");
      expect(isPlaceholderWordPressCourse(course)).toBe(true);
      expect(resolveWordPressCourseMapping(course, identities)).toEqual({ kind: "ignore", reason: "IGNORED_PLACEHOLDER" });
    }
  });

  it("reconoce el placeholder por título aunque el slug sea distinto", () => {
    for (const title of ["Próximamente", "próximamente", "PRÓXIMAMENTE", "  Proximamente  "]) {
      expect(isPlaceholderWordPressCourse(wordpress("9001", "pagina-generica", title))).toBe(true);
    }
  });

  it("no ignora un curso real que contiene la palabra próximamente", () => {
    // La coincidencia es exacta: un curso legítimo no puede desaparecer del
    // catálogo por mencionar la palabra.
    const casos = [
      wordpress("9101", "marketing-proximamente-nuevas-fechas", "Marketing: próximamente nuevas fechas"),
      wordpress("9102", "proximamente-en-vivo", "Taller próximamente en vivo"),
      wordpress("9103", "curso-proximamente", "Curso Próximamente Disponible"),
    ];
    for (const course of casos) {
      expect(isPlaceholderWordPressCourse(course)).toBe(false);
      expect(resolveWordPressCourseMapping(course, identities).kind).not.toBe("ignore");
    }
  });

  it("el placeholder se ignora incluso si una sincronización previa lo enlazó", () => {
    const linked = [...identities, { id: "curso-fantasma", slug: "proximamente", crmSlug: null, externalId: "2238", externalSource: "wordpress" }];
    expect(resolveWordPressCourseMapping(wordpress("2238", "proximamente", "Próximamente"), linked))
      .toEqual({ kind: "ignore", reason: "IGNORED_PLACEHOLDER" });
  });

  it("rechaza un enlace explícito ambiguo o asociado a otra fuente", () => {
    const target = identities.find((course) => course.slug === WORDPRESS_CRM_SLUG_BY_ID["2231"]);
    if (!target) throw new Error("Falta el curso explícito de prueba.");
    expect(resolveWordPressCourseMapping(wordpress("2231"), [{ ...target, externalSource: "moodle" }])).toMatchObject({ kind: "conflict", reason: "COURSE_LINKED_TO_ANOTHER_SOURCE" });
  });
});
