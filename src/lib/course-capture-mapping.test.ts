import { describe, expect, it } from "vitest";
import {
  CRM_PUBLIC_URL,
  OFFICIAL_COURSE_CATALOG_URL,
  courseCaptureMappings,
  findCourseCaptureMappingByCrmSlug,
  findCourseCaptureMappingByOfficialPath,
} from "@/data/course-capture-mapping";
import { buildCourseCtaScript } from "./course-cta-script";

describe("mapeo oficial de captacion por curso", () => {
  it("mantiene los 11 cursos visibles con slugs CRM unicos", () => {
    expect(courseCaptureMappings).toHaveLength(11);
    expect(new Set(courseCaptureMappings.map((course) => course.crmCourseSlug)).size).toBe(11);
    expect(courseCaptureMappings.every((course) => course.published && course.catalogVisible)).toBe(true);
  });

  it("mapea las nueve paginas oficiales sin inferir los dos cursos sin pagina", () => {
    const pages = courseCaptureMappings.filter((course) => course.hasOfficialPage);
    const withoutPage = courseCaptureMappings.filter((course) => !course.hasOfficialPage);
    expect(pages).toHaveLength(9);
    expect(pages.every((course) => course.officialCourseSlug && course.hasPrimaryCta)).toBe(true);
    expect(withoutPage.map((course) => course.crmCourseSlug)).toEqual([
      "ia-desarrollo-tesis",
      "ia-investigacion-contenido-marketing",
    ]);
    expect(withoutPage.every((course) => (
      course.officialCourseSlug === null
      && course.officialCourseUrl === OFFICIAL_COURSE_CATALOG_URL
      && !course.hasPrimaryCta
    ))).toBe(true);
  });

  it("conserva de forma explicita el slug distinto del curso de tareas", () => {
    const mapping = findCourseCaptureMappingByOfficialPath("/cursos/ia-para-apoyo-en-tareas-escolares/");
    expect(mapping?.crmCourseSlug).toBe("ia-apoyo-tareas-estudiantiles");
    expect(mapping?.startDate).toBe("11 de agosto");
    expect(mapping?.endDate).toBe("13 de agosto");
    expect(findCourseCaptureMappingByCrmSlug("ia-apoyo-tareas-estudiantiles")).toBe(mapping);
  });

  it("solo produce formularios publicos HTTPS, nunca localhost ni rutas administrativas", () => {
    for (const course of courseCaptureMappings) {
      const url = new URL(course.crmFormUrl);
      expect(url.origin).toBe(CRM_PUBLIC_URL);
      expect(url.protocol).toBe("https:");
      expect(url.pathname).toBe(`/cursos/${course.crmCourseSlug}`);
      expect(url.pathname).not.toContain("/admin");
    }
  });

  it("el script cambia solo el destino y conserva cada UTM una sola vez", () => {
    const anchor = {
      href: "https://wa.me/593000000000",
      dataset: {} as Record<string, string>,
      addEventListener() {},
    };
    const location = new URL(
      "https://ra-training.com/cursos/ia-para-apoyo-en-tareas-escolares/?utm_source=facebook&utm_medium=paid_social&utm_campaign=agosto&utm_content=video_01&utm_term=ia&utm_source=duplicado&fbclid=fb_123&gclid=google_123&ttclid=tiktok_123",
    );
    const documentObject = {
      currentScript: { src: "https://preview.example.test/course-cta.js" },
      referrer: "https://facebook.example.test/anuncio",
      querySelectorAll(selector: string) {
        expect(selector).toBe("a.boton-clase");
        return [anchor];
      },
    };
    new Function("window", "document", buildCourseCtaScript())({ location }, documentObject);

    const destination = new URL(anchor.href);
    expect(destination.origin).toBe("https://preview.example.test");
    expect(destination.pathname).toBe("/cursos/ia-apoyo-tareas-estudiantiles");
    expect(destination.searchParams.get("utm_source")).toBe("facebook");
    for (const key of [
      "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
      "fbclid", "gclid", "ttclid",
    ]) {
      expect(destination.searchParams.getAll(key)).toHaveLength(1);
    }
    expect(destination.searchParams.get("fbclid")).toBe("fb_123");
    expect(destination.searchParams.get("gclid")).toBe("google_123");
    expect(destination.searchParams.get("ttclid")).toBe("tiktok_123");
    expect(destination.searchParams.get("landing_url")).toContain("ra-training.com/cursos/");
    expect(destination.searchParams.get("referrer")).toBe("https://facebook.example.test/anuncio");
    expect(anchor.dataset.crmCourse).toBe("ia-apoyo-tareas-estudiantiles");
  });
});
