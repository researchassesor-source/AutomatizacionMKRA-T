import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWordPressCourses, normalizeWordPressCourse, safeWordPressErrorCode } from "./wordpress-catalog";

afterEach(() => vi.unstubAllEnvs());

describe("catálogo WordPress de solo lectura", () => {
  const source = { id: 81, slug: "curso-oficial", link: "https://ra-training.com/cursos/curso-oficial/", modified_gmt: "2026-08-03T12:30:00", title: { rendered: "Curso &amp; Taller" }, acf: { crm_slug: "curso-crm" } };

  it("normaliza ID externo, slug oficial y crmSlug explícito", () => {
    expect(normalizeWordPressCourse(source)).toMatchObject({ externalId: "81", officialSlug: "curso-oficial", crmSlug: "curso-crm", title: "Curso & Taller" });
  });

  it("exige endpoint HTTPS y solo ejecuta GET", async () => {
    vi.stubEnv("WORDPRESS_COURSES_API_URL", "https://ra-training.com/wp-json/wp/v2/sfwd-courses");
    const fetcher = vi.fn(async (_url: URL, _init: RequestInit) => new Response(JSON.stringify([source]), { status: 200, headers: { "x-wp-totalpages": "1" } }));
    await expect(fetchWordPressCourses(fetcher as typeof fetch)).resolves.toHaveLength(1);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe("GET");
  });

  it("se detiene ante IDs externos duplicados", async () => {
    vi.stubEnv("WORDPRESS_COURSES_API_URL", "https://ra-training.com/wp-json/wp/v2/sfwd-courses");
    const fetcher = vi.fn(async () => new Response(JSON.stringify([source, source]), { status: 200 }));
    await expect(fetchWordPressCourses(fetcher as typeof fetch)).rejects.toThrow("DUPLICATE_EXTERNAL_ID");
  });

  it("no expone detalles de configuración en los errores", () => {
    expect(safeWordPressErrorCode(new Error("Invalid URL containing a private value"))).toBe("WORDPRESS_SYNC_FAILED");
    expect(safeWordPressErrorCode(new Error("WORDPRESS_API_HTTP_403"))).toBe("WORDPRESS_API_HTTP_403");
  });
});
