import { describe, expect, it } from "vitest";
import { normalizeSocialCaption, parseSocialCopy } from "./caption-formatting";

describe("formato visual del copy", () => {
  it("reconoce negrita con asteriscos y guiones bajos", () => {
    expect(parseSocialCopy("**Inteligencia Artificial** y __automatización__")).toEqual([
      { text: "Inteligencia Artificial", style: "bold" },
      { text: " y ", style: "plain" },
      { text: "automatización", style: "bold" },
    ]);
  });

  it("reconoce cursiva con asteriscos y guiones bajos", () => {
    expect(parseSocialCopy("Aprende *de forma práctica* y _a tu ritmo_.")).toEqual([
      { text: "Aprende ", style: "plain" },
      { text: "de forma práctica", style: "italic" },
      { text: " y ", style: "plain" },
      { text: "a tu ritmo", style: "italic" },
      { text: ".", style: "plain" },
    ]);
  });

  it("genera un caption limpio sin romper emojis, URLs, hashtags ni saltos", () => {
    const input = "🚀 Aprende **IA** de forma *práctica*.\n\nhttps://ra-training.com/curso_ia\n#IA_para_todos";
    expect(normalizeSocialCaption(input)).toBe("🚀 Aprende IA de forma práctica.\n\nhttps://ra-training.com/curso_ia\n#IA_para_todos");
  });

  it("preserva listas simples y marcadores incompletos como texto normal", () => {
    expect(normalizeSocialCaption("* punto uno\n- punto dos\nTexto *sin cerrar")).toBe("* punto uno\n- punto dos\nTexto *sin cerrar");
  });
});
