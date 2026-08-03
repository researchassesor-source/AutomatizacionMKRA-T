import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("página de confirmación", () => {
  it("regresa al catálogo oficial y no al login del CRM", () => {
    const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

    expect(source).toContain('href={OFFICIAL_COURSE_CATALOG_URL}');
    expect(source).not.toContain('href="/"');
  });
});
