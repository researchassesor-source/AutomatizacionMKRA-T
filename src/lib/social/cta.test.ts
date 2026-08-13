import { describe, expect, it } from "vitest";
import {
  AVISO_INSTAGRAM_SIN_ENLACE,
  componerCaption,
  CTA_INSTAGRAM_POR_DEFECTO,
  esUrlDestinoValida,
  requiereAvisoInstagram,
  textoYaIncluyeUrl,
  urlCanonica,
} from "./cta";

const URL_CURSO = "https://automatizacion-mkra-t2.vercel.app/cursos/ia-para-tareas";
const TEXTO = "🚀 ¡Aprende con IA!\n\nCupos limitados.\n\n#IA #Educación";

describe("URL de destino", () => {
  it("acepta HTTPS sobre un dominio público", () => {
    expect(esUrlDestinoValida(URL_CURSO)).toBe(true);
    expect(esUrlDestinoValida("https://ra-training.com")).toBe(true);
  });

  it("rechaza lo que no puede publicarse", () => {
    // http: Facebook degrada el contenido mixto y es mala señal para quien lo recibe.
    expect(esUrlDestinoValida("http://ra-training.com")).toBe(false);
    expect(esUrlDestinoValida("https://localhost:3000/cursos")).toBe(false);
    expect(esUrlDestinoValida("https://127.0.0.1/cursos")).toBe(false);
    expect(esUrlDestinoValida("https://192.168.1.10/cursos")).toBe(false);
    // Sin punto solo resuelve dentro de una red interna.
    expect(esUrlDestinoValida("https://intranet")).toBe(false);
    expect(esUrlDestinoValida("no-es-una-url")).toBe(false);
    expect(esUrlDestinoValida("")).toBe(false);
    expect(esUrlDestinoValida("   ")).toBe(false);
  });
});

describe("comparación de URLs", () => {
  it("ignora www, barra final y parámetros de campaña", () => {
    expect(urlCanonica("https://www.ra-training.com/cursos/ia/")).toBe(urlCanonica("https://ra-training.com/cursos/ia"));
    expect(urlCanonica("https://ra-training.com/c?utm_source=ig&utm_medium=bio")).toBe(urlCanonica("https://ra-training.com/c"));
    expect(urlCanonica("https://ra-training.com/c?fbclid=abc")).toBe(urlCanonica("https://ra-training.com/c"));
  });

  it("no confunde destinos distintos", () => {
    expect(urlCanonica("https://ra-training.com/cursos/ia")).not.toBe(urlCanonica("https://ra-training.com/cursos/excel"));
  });

  it("detecta que el texto ya trae la URL aunque esté escrita de otra forma", () => {
    expect(textoYaIncluyeUrl("Inscríbete en https://www.ra-training.com/cursos/ia/", "https://ra-training.com/cursos/ia")).toBe(true);
    expect(textoYaIncluyeUrl("Inscríbete en https://ra-training.com/cursos/excel", "https://ra-training.com/cursos/ia")).toBe(false);
  });
});

describe("Facebook recibe la URL", () => {
  it("elimina Markdown visual antes de guardar el caption de Meta", () => {
    const salida = componerCaption({
      plataforma: "FACEBOOK",
      textoBase: "🚀 Aprende **Inteligencia Artificial** de forma *práctica*.",
    });
    expect(salida).toBe("🚀 Aprende Inteligencia Artificial de forma práctica.");
    expect(salida).not.toMatch(/\*\*|__/);
  });

  it("añade la URL al final, preservando saltos y hashtags", () => {
    const salida = componerCaption({ plataforma: "FACEBOOK", textoBase: TEXTO, urlDestino: URL_CURSO });
    expect(salida).toBe(`${TEXTO}\n\n${URL_CURSO}`);
    expect(salida).toContain("#IA #Educación");
    expect(salida).toContain("Cupos limitados.");
  });

  it("NO duplica la URL si el texto ya la incluye", () => {
    const conUrl = `Mira el curso en ${URL_CURSO} y apúntate.`;
    const salida = componerCaption({ plataforma: "FACEBOOK", textoBase: conUrl, urlDestino: URL_CURSO });
    expect(salida).toBe(conUrl);
    expect(salida.match(/automatizacion-mkra-t2/g)).toHaveLength(1);
  });

  it("tampoco duplica cuando el texto la trae con www o barra final", () => {
    const conVariante = `Inscríbete: https://www.automatizacion-mkra-t2.vercel.app/cursos/ia-para-tareas/`;
    const salida = componerCaption({ plataforma: "FACEBOOK", textoBase: conVariante, urlDestino: URL_CURSO });
    expect(salida).toBe(conVariante);
  });

  it("sin URL no añade nada", () => {
    expect(componerCaption({ plataforma: "FACEBOOK", textoBase: TEXTO })).toBe(TEXTO);
  });

  it("una URL inválida no se cuela en la publicación", () => {
    expect(componerCaption({ plataforma: "FACEBOOK", textoBase: TEXTO, urlDestino: "http://localhost:3000" })).toBe(TEXTO);
  });
});

describe("Instagram recibe su propio CTA", () => {
  it("añade el CTA y NUNCA la URL", () => {
    const salida = componerCaption({
      plataforma: "INSTAGRAM",
      textoBase: TEXTO,
      urlDestino: URL_CURSO,
      ctaInstagram: CTA_INSTAGRAM_POR_DEFECTO,
    });
    expect(salida).toBe(`${TEXTO}\n\n${CTA_INSTAGRAM_POR_DEFECTO}`);
    // El caption de Instagram no genera enlaces: una URL ahí solo ocupa espacio.
    expect(salida).not.toContain("https://");
  });

  it("respeta un CTA personalizado", () => {
    const propio = "Escríbenos por mensaje directo 💬";
    const salida = componerCaption({ plataforma: "INSTAGRAM", textoBase: TEXTO, urlDestino: URL_CURSO, ctaInstagram: propio });
    expect(salida).toBe(`${TEXTO}\n\n${propio}`);
  });

  it("con el CTA vacío no añade nada, ni siquiera la URL", () => {
    const salida = componerCaption({ plataforma: "INSTAGRAM", textoBase: TEXTO, urlDestino: URL_CURSO, ctaInstagram: "" });
    expect(salida).toBe(TEXTO);
  });

  it("no repite el CTA si el texto ya lo trae", () => {
    const yaConCta = `${TEXTO}\n\n${CTA_INSTAGRAM_POR_DEFECTO}`;
    const salida = componerCaption({ plataforma: "INSTAGRAM", textoBase: yaConCta, ctaInstagram: CTA_INSTAGRAM_POR_DEFECTO });
    expect(salida.match(/enlace en nuestra bio/g)).toHaveLength(1);
  });
});

describe("las dos redes producen textos distintos del mismo original", () => {
  it("Facebook lleva URL e Instagram lleva CTA", () => {
    const entrada = { textoBase: TEXTO, urlDestino: URL_CURSO, ctaInstagram: CTA_INSTAGRAM_POR_DEFECTO } as const;
    const facebook = componerCaption({ ...entrada, plataforma: "FACEBOOK" });
    const instagram = componerCaption({ ...entrada, plataforma: "INSTAGRAM" });

    expect(facebook).not.toBe(instagram);
    expect(facebook).toContain(URL_CURSO);
    expect(instagram).not.toContain(URL_CURSO);
    expect(instagram).toContain("nuestra bio");
    // El texto original sobrevive intacto en las dos.
    expect(facebook.startsWith(TEXTO)).toBe(true);
    expect(instagram.startsWith(TEXTO)).toBe(true);
  });
});

describe("aviso de Instagram", () => {
  it("avisa solo cuando hay Instagram y algo que enlazar", () => {
    expect(requiereAvisoInstagram(["INSTAGRAM"], URL_CURSO)).toBe(true);
    expect(requiereAvisoInstagram(["FACEBOOK", "INSTAGRAM"], URL_CURSO)).toBe(true);
    // Sin URL no hay nada que advertir: avisar siempre convierte el mensaje en ruido.
    expect(requiereAvisoInstagram(["INSTAGRAM"], "")).toBe(false);
    expect(requiereAvisoInstagram(["FACEBOOK"], URL_CURSO)).toBe(false);
  });

  it("el aviso está redactado para una persona, sin jerga", () => {
    expect(AVISO_INSTAGRAM_SIN_ENLACE).toContain("enlace del perfil");
    expect(AVISO_INSTAGRAM_SIN_ENLACE).not.toMatch(/API|caption|markdown|HTML/i);
  });
});
