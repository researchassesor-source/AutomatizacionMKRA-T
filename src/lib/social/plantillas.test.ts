import { describe, expect, it } from "vitest";
import {
  agregarPlantilla,
  aplicarPlantilla,
  crearPlantilla,
  eliminarPlantilla,
  leerPlantillas,
  MAXIMO_PLANTILLAS,
  nombrePorDefecto,
  normalizarPlantilla,
  renombrarPlantilla,
  seleccionParaPlantilla,
} from "./plantillas";

const AHORA = new Date("2026-08-08T18:00:00.000Z");

const BORRADOR = {
  texto: "🚀 ¡Aprende con IA!\n\nCupos limitados.\n\n#IA #Educación",
  enlace: "https://automatizacion-mkra-t2.vercel.app/cursos/ia",
  imagen: "https://oxsqbhg0pmmalrwl.public.blob.vercel-storage.com/social/foto.jpg",
  ctaInstagram: "👉 Inscríbete desde el enlace en nuestra bio.",
  plataformas: ["FACEBOOK", "INSTAGRAM"],
};

const CUENTAS = [
  { id: "cuenta-fb", platform: "FACEBOOK" },
  { id: "cuenta-ig", platform: "INSTAGRAM" },
  { id: "cuenta-tt", platform: "TIKTOK" },
];

describe("guardar una plantilla", () => {
  it("conserva todo lo reutilizable del compositor", () => {
    const plantilla = crearPlantilla(BORRADOR, AHORA, "p1");
    expect(plantilla).toMatchObject({
      id: "p1",
      texto: BORRADOR.texto,
      enlace: BORRADOR.enlace,
      imagen: BORRADOR.imagen,
      ctaInstagram: BORRADOR.ctaInstagram,
      plataformas: ["FACEBOOK", "INSTAGRAM"],
    });
  });

  it("NUNCA guarda la fecha ni la hora de programación", () => {
    // Es la garantia central: usar una plantilla vieja no puede programar algo
    // para un momento ya pasado ni a una hora que nadie eligio.
    const plantilla = crearPlantilla({ ...BORRADOR, ...({ cuando: "2026-08-09T14:00" } as object) }, AHORA, "p1");
    const claves = Object.keys(plantilla);
    expect(claves).not.toContain("cuando");
    expect(claves).not.toContain("scheduledAt");
    expect(claves).not.toContain("repetir");
    expect(JSON.stringify(plantilla)).not.toContain("2026-08-09T14:00");
  });

  it("usa la primera línea como nombre cuando no se da uno", () => {
    expect(nombrePorDefecto(BORRADOR.texto)).toBe("🚀 ¡Aprende con IA!");
    expect(nombrePorDefecto("   ")).toBe("Plantilla sin título");
  });

  it("respeta un nombre propio", () => {
    expect(crearPlantilla({ ...BORRADOR, nombre: "Campaña agosto" }, AHORA).nombre).toBe("Campaña agosto");
  });

  it("no repite plataformas duplicadas", () => {
    const plantilla = crearPlantilla({ ...BORRADOR, plataformas: ["FACEBOOK", "FACEBOOK", "INSTAGRAM"] }, AHORA);
    expect(plantilla.plataformas).toEqual(["FACEBOOK", "INSTAGRAM"]);
  });
});

describe("recuperar y utilizar", () => {
  it("el ciclo completo devuelve exactamente lo guardado", () => {
    const plantilla = crearPlantilla(BORRADOR, AHORA, "p1");
    const guardadas = agregarPlantilla([], plantilla);
    const recuperadas = leerPlantillas(JSON.stringify(guardadas));
    expect(recuperadas).toHaveLength(1);

    const estado = aplicarPlantilla(recuperadas[0]);
    expect(estado).toEqual({
      texto: BORRADOR.texto,
      enlace: BORRADOR.enlace,
      imagen: BORRADOR.imagen,
      ctaInstagram: BORRADOR.ctaInstagram,
      plataformas: ["FACEBOOK", "INSTAGRAM"],
    });
  });

  it("lo que se restaura no incluye programación", () => {
    const estado = aplicarPlantilla(crearPlantilla(BORRADOR, AHORA));
    expect(Object.keys(estado).sort()).toEqual(["ctaInstagram", "enlace", "imagen", "plataformas", "texto"]);
  });

  it("selecciona las cuentas de las redes guardadas", () => {
    const plantilla = crearPlantilla(BORRADOR, AHORA);
    expect(seleccionParaPlantilla(plantilla, CUENTAS, [])).toEqual(["cuenta-fb", "cuenta-ig"]);
  });

  it("una plantilla antigua sin redes conserva la selección actual", () => {
    // Vaciar las casillas marcadas sin avisar es peor que no restaurarlas.
    const antigua = crearPlantilla({ ...BORRADOR, plataformas: [] }, AHORA);
    expect(seleccionParaPlantilla(antigua, CUENTAS, ["cuenta-tt"])).toEqual(["cuenta-tt"]);
  });

  it("editar tras aplicar no toca la plantilla guardada", () => {
    const guardadas = agregarPlantilla([], crearPlantilla(BORRADOR, AHORA, "p1"));
    const estado = aplicarPlantilla(guardadas[0]);
    // Simula que quien escribe modifica el copy antes de publicar.
    const editado = { ...estado, texto: "Texto cambiado" };
    expect(editado.texto).toBe("Texto cambiado");
    expect(guardadas[0].texto).toBe(BORRADOR.texto);
  });
});

describe("renombrar y eliminar", () => {
  const lista = [crearPlantilla(BORRADOR, AHORA, "p1"), crearPlantilla({ ...BORRADOR, nombre: "Otra" }, AHORA, "p2")];

  it("renombra solo la indicada", () => {
    const resultado = renombrarPlantilla(lista, "p1", "  Campaña de agosto  ");
    expect(resultado.find((item) => item.id === "p1")?.nombre).toBe("Campaña de agosto");
    expect(resultado.find((item) => item.id === "p2")?.nombre).toBe("Otra");
  });

  it("un nombre vacío no borra el que había", () => {
    expect(renombrarPlantilla(lista, "p1", "   ").find((item) => item.id === "p1")?.nombre).toBe(lista[0].nombre);
  });

  it("elimina solo la indicada", () => {
    expect(eliminarPlantilla(lista, "p1").map((item) => item.id)).toEqual(["p2"]);
  });

  it("guardar de nuevo con el mismo id la reemplaza, no la duplica", () => {
    const actualizada = crearPlantilla({ ...BORRADOR, texto: "nuevo" }, AHORA, "p1");
    const resultado = agregarPlantilla(lista, actualizada);
    expect(resultado.filter((item) => item.id === "p1")).toHaveLength(1);
    expect(resultado[0].texto).toBe("nuevo");
  });

  it("no crece por encima del tope", () => {
    let lista: ReturnType<typeof crearPlantilla>[] = [];
    for (let i = 0; i < MAXIMO_PLANTILLAS + 5; i++) {
      lista = agregarPlantilla(lista, crearPlantilla(BORRADOR, AHORA, `p${i}`));
    }
    expect(lista).toHaveLength(MAXIMO_PLANTILLAS);
  });
});

describe("lectura tolerante de lo guardado", () => {
  it("completa las plantillas creadas antes de este cambio", () => {
    const antigua = { id: "vieja", nombre: "Antigua", texto: "Hola", enlace: "", imagen: "" };
    const normalizada = normalizarPlantilla(antigua);
    expect(normalizada).toMatchObject({ id: "vieja", ctaInstagram: "", plataformas: [] });
  });

  it("descarta entradas sin identificador o sin nombre", () => {
    expect(normalizarPlantilla({ nombre: "Sin id" })).toBeNull();
    expect(normalizarPlantilla({ id: "x", nombre: "  " })).toBeNull();
    expect(normalizarPlantilla("no es un objeto")).toBeNull();
  });

  it("un almacenamiento corrupto no rompe el compositor", () => {
    expect(leerPlantillas("{no es json")).toEqual([]);
    expect(leerPlantillas(null)).toEqual([]);
    expect(leerPlantillas('{"no":"es una lista"}')).toEqual([]);
  });
});
