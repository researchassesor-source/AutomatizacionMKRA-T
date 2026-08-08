/**
 * Plantillas de publicacion.
 *
 * Guardan lo que cuesta volver a escribir —el copy, las redes, los CTA, el
 * enlace y la imagen— y NUNCA la fecha. Una plantilla es un punto de partida
 * reutilizable; heredar la hora de la publicacion anterior significaria que
 * usar una plantilla vieja programa algo para un momento ya pasado, o peor,
 * que alguien publique sin darse cuenta a una hora que no eligio.
 *
 * Viven en el navegador a proposito: son borradores de trabajo de quien
 * escribe, no contenido del CRM. Eso evita una migracion de base de datos y
 * mantiene el alcance del cambio pequeño.
 *
 * Las redes se guardan por PLATAFORMA y no por identificador de cuenta. Los
 * identificadores cambian cuando se vuelve a registrar una cuenta, y entonces
 * la plantilla apuntaria a algo que ya no existe; la plataforma sobrevive.
 */

export const PLANTILLAS_KEY = "ra-crm:plantillas-publicacion";

/** Tope de plantillas guardadas: es una lista de trabajo, no un archivo. */
export const MAXIMO_PLANTILLAS = 12;

export type PlantillaPublicacion = {
  id: string;
  nombre: string;
  /** Texto base, sin CTA ni URL añadidas: eso se compone al publicar. */
  texto: string;
  enlace: string;
  imagen: string;
  ctaInstagram: string;
  plataformas: string[];
  creadaEn: string;
};

/** Lo que la plantilla puede devolver al compositor. Sin fecha, a proposito. */
export type EstadoRestaurable = {
  texto: string;
  enlace: string;
  imagen: string;
  ctaInstagram: string;
  plataformas: string[];
};

/**
 * Lectura tolerante de lo que hay en el navegador.
 *
 * Las plantillas guardadas antes de este cambio no tienen `plataformas` ni
 * `ctaInstagram`. Descartarlas seria perder el trabajo de quien las creo, asi
 * que se completan con valores neutros: sin plataformas, la seleccion de redes
 * simplemente no se toca al aplicarlas.
 */
export function normalizarPlantilla(raw: unknown): PlantillaPublicacion | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const id = typeof item.id === "string" ? item.id : null;
  const nombre = typeof item.nombre === "string" ? item.nombre.trim() : "";
  if (!id || !nombre) return null;

  const texto = typeof item.texto === "string" ? item.texto : "";
  return {
    id,
    nombre,
    texto,
    enlace: typeof item.enlace === "string" ? item.enlace : "",
    imagen: typeof item.imagen === "string" ? item.imagen : "",
    ctaInstagram: typeof item.ctaInstagram === "string" ? item.ctaInstagram : "",
    plataformas: Array.isArray(item.plataformas)
      ? item.plataformas.filter((valor): valor is string => typeof valor === "string" && valor.length > 0)
      : [],
    creadaEn: typeof item.creadaEn === "string" ? item.creadaEn : new Date(0).toISOString(),
  };
}

export function leerPlantillas(crudo: string | null): PlantillaPublicacion[] {
  if (!crudo) return [];
  try {
    const lista = JSON.parse(crudo);
    if (!Array.isArray(lista)) return [];
    return lista.map(normalizarPlantilla).filter((item): item is PlantillaPublicacion => item !== null);
  } catch {
    // Un contenido corrupto no puede dejar el compositor inutilizable.
    return [];
  }
}

/**
 * Nombre de una plantilla nueva.
 *
 * La primera linea del texto es lo que quien escribe reconoce de un vistazo, y
 * evita pedir un titulo aparte solo para poder guardar.
 */
export function nombrePorDefecto(texto: string): string {
  const primeraLinea = texto.trim().split("\n")[0]?.trim() ?? "";
  return primeraLinea.slice(0, 44) || "Plantilla sin título";
}

export type BorradorPlantilla = {
  nombre?: string;
  texto: string;
  enlace: string;
  imagen: string;
  ctaInstagram: string;
  plataformas: string[];
};

/**
 * Crea la plantilla a partir del estado del compositor.
 *
 * El tipo de entrada no incluye la fecha, asi que no es posible colarla por
 * descuido: no existe campo donde ponerla.
 */
export function crearPlantilla(borrador: BorradorPlantilla, ahora = new Date(), id = String(ahora.getTime())): PlantillaPublicacion {
  return {
    id,
    nombre: borrador.nombre?.trim() || nombrePorDefecto(borrador.texto),
    texto: borrador.texto,
    enlace: borrador.enlace,
    imagen: borrador.imagen,
    ctaInstagram: borrador.ctaInstagram,
    plataformas: [...new Set(borrador.plataformas)],
    creadaEn: ahora.toISOString(),
  };
}

/** Añade la plantilla al principio y respeta el tope. */
export function agregarPlantilla(lista: readonly PlantillaPublicacion[], plantilla: PlantillaPublicacion): PlantillaPublicacion[] {
  return [plantilla, ...lista.filter((item) => item.id !== plantilla.id)].slice(0, MAXIMO_PLANTILLAS);
}

export function renombrarPlantilla(lista: readonly PlantillaPublicacion[], id: string, nombre: string): PlantillaPublicacion[] {
  const limpio = nombre.trim();
  if (!limpio) return [...lista];
  return lista.map((item) => (item.id === id ? { ...item, nombre: limpio.slice(0, 60) } : item));
}

export function eliminarPlantilla(lista: readonly PlantillaPublicacion[], id: string): PlantillaPublicacion[] {
  return lista.filter((item) => item.id !== id);
}

/**
 * Estado que hay que restaurar en el compositor.
 *
 * Devuelve solo campos reutilizables. La programacion no aparece porque el
 * tipo no la contempla: quien use esto no puede heredarla ni queriendo.
 */
export function aplicarPlantilla(plantilla: PlantillaPublicacion): EstadoRestaurable {
  return {
    texto: plantilla.texto,
    enlace: plantilla.enlace,
    imagen: plantilla.imagen,
    ctaInstagram: plantilla.ctaInstagram,
    plataformas: [...plantilla.plataformas],
  };
}

/**
 * Cuentas que hay que marcar al aplicar la plantilla.
 *
 * Si la plantilla no guardo plataformas —las creadas antes de este cambio— se
 * conserva la seleccion actual en lugar de vaciarla: perder las casillas
 * marcadas sin avisar es peor que no restaurarlas.
 */
export function seleccionParaPlantilla(
  plantilla: PlantillaPublicacion,
  cuentas: readonly { id: string; platform: string }[],
  seleccionActual: readonly string[],
): string[] {
  if (plantilla.plataformas.length === 0) return [...seleccionActual];
  return cuentas.filter((cuenta) => plantilla.plataformas.includes(cuenta.platform)).map((cuenta) => cuenta.id);
}
