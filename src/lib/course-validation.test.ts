import { describe, expect, it } from "vitest";
import { courseInputSchema, isTrustedMoodleUrl, isTrustedOfficialCourseUrl } from "./course-validation";

const course = {
  slug: "curso-seguro",
  title: "Curso seguro de prueba",
  officialCourseUrl: "https://ra-training.com/courses-1/",
  displayOrder: 10,
  isFree: false,
  isPublished: true,
  isLeadMagnet: false,
  hasCertificate: true,
};

describe("cursos administrables", () => {
  it("acepta creación válida", () => expect(courseInputSchema.safeParse(course).success).toBe(true));
  it("acepta actualización con URL oficial específica", () => expect(courseInputSchema.safeParse({ ...course, officialCourseUrl: "https://ra-training.com/cursos/curso-seguro/" }).success).toBe(true));
  it("rechaza una redirección arbitraria", () => expect(isTrustedOfficialCourseUrl("https://evil.example/robo")).toBe(false));
  it("acepta únicamente Moodle institucional", () => {
    expect(isTrustedMoodleUrl("https://moodle.ra-training.com/course/view.php?id=1")).toBe(true);
    expect(isTrustedMoodleUrl("https://moodle.example.com/course/1")).toBe(false);
  });
  it("permite desactivar la publicación", () => expect(courseInputSchema.parse({ ...course, isPublished: false }).isPublished).toBe(false));
  it("rechaza un cierre anterior al inicio", () => {
    expect(courseInputSchema.safeParse({ ...course, startsAt: "2026-08-02T14:00:00.000Z", endsAt: "2026-08-01T14:00:00.000Z" }).success).toBe(false);
  });
});
