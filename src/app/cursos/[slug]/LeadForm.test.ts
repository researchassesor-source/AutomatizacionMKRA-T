import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./LeadForm.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../../globals.css", import.meta.url), "utf8");

describe("formulario publico de cursos", () => {
  it("mantiene visibles los cuatro campos y consentimiento obligatorios", () => {
    for (const name of ["firstName", "lastName", "email", "phone", "consent"]) {
      expect(source).toContain(`name="${name}"`);
    }
    expect(source.match(/required/g)?.length).toBeGreaterThanOrEqual(5);
    expect(source).toContain("Autorizo a R.A. Training");
  });

  it("solicita teclados y autocompletado correctos", () => {
    expect(source).toContain('type="email"');
    expect(source).toContain('inputMode="email"');
    expect(source).toContain('autoComplete="email"');
    expect(source).toContain('type="tel"');
    expect(source).toContain('inputMode="tel"');
    expect(source).toContain('autoComplete="tel"');
  });

  it("expone errores accesibles, foco y estado de envio", () => {
    expect(source).toContain("aria-invalid");
    expect(source).toContain("aria-describedby");
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('role="alert"');
    expect(source).toContain("control.focus()");
    expect(source).toContain('aria-busy={loading}');
  });

  it("bloquea doble clic y recupera el formulario despues de un error", () => {
    expect(source).toContain("if (submitting.current) return");
    expect(source).toContain("submitting.current = true");
    expect(source).toContain("submitting.current = false");
    expect(source).toContain("disabled={loading}");
    expect(source).not.toContain("form.reset()");
  });

  it("incluye controles responsive sin overflow y objetivos tactiles suficientes", () => {
    expect(css).toContain(".course-landing .grid > * { min-width: 0; }");
    expect(css).toContain(".public-hero-grid, .grid { grid-template-columns: 1fr; }");
    expect(css).toContain(".btn { width: 100%; min-height: 48px;");
    expect(css).toContain(".field input, .field select, .field textarea");
    expect(css).toContain("width: 100%; min-height: 44px;");
  });

  it("solo muestra la politica cuando existe una URL oficial configurada", () => {
    expect(source).toContain("NEXT_PUBLIC_PRIVACY_POLICY_URL");
    expect(source).toContain("PRIVACY_POLICY_URL ?");
    expect(source).not.toContain("/privacy-policy");
  });
});
