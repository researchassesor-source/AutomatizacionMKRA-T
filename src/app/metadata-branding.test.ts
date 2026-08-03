import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("branding y metadata del CRM", () => {
  it("incluye todos los iconos y manifest requeridos", () => {
    const publicDirectory = resolve(process.cwd(), "public");
    for (const file of ["favicon.ico", "favicon-16x16.png", "favicon-32x32.png", "favicon-48x48.png", "apple-touch-icon.png", "icon-192x192.png", "icon-512x512.png", "crm-og.png"]) expect(existsSync(resolve(publicDirectory, file)), file).toBe(true);
    const layout = readFileSync(resolve(process.cwd(), "src/app/layout.tsx"), "utf8");
    expect(layout).toContain("/manifest.webmanifest");
    expect(layout).toContain("/apple-touch-icon.png");
    expect(layout).toContain("/crm-og.png");
  });
});
