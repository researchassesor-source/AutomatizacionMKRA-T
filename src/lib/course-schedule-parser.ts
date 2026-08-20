/**
 * Lectura de fechas y horario desde la ficha publica del curso.
 *
 * La API REST de WordPress no expone estos datos: `acf` viene vacio y
 * `content.rendered` tambien, verificado en vivo contra
 * `/wp-json/wp/v2/cursos` (sección M del release de estabilización) sobre
 * varios cursos reales, no solo uno. No es una limitacion de permisos ni algo
 * que cambie agregando un parametro: esos campos simplemente no se exponen
 * para este tipo de contenido. La pagina publica SI los muestra, asi que el
 * parser de HTML sigue siendo la unica fuente posible, no un respaldo
 * temporal a reemplazar.
 *
 * El bloque de fecha tuvo DOS disenos distintos, y este modulo reconoce los
 * dos (el legacy manda si aparece; el actual solo rellena lo que el legacy no
 * encontro):
 *
 *   LEGACY:
 *   <span class="dato__etiqueta">Inicio</span>
 *   <span class="dato__valor">11, 12, y 13 de Agosto</span>
 *   <span class="dato__etiqueta">Horario</span>
 *   <span class="dato__valor">Martes, Miércoles, Jueves  7:30-9:00 pm</span>
 *
 *   ACTUAL (verificado en vivo contra ra-training.com, 2026-08-19):
 *   <div class="tk-dates">
 *     <div class="dt-head">...<h3>INICIO DEL CURSO</h3></div>
 *     <div class="dt-card"><div class="dt-days">
 *       <div class="dt-day"><b>Próximamente</b></div>
 *     </div></div>
 *   </div>
 *
 * El diseño actual NO publica ningun campo de horario en ningun lugar de la
 * ficha (se comprobo en varios cursos reales): por eso `proponerCalendario`
 * sigue rechazando con un motivo explicito en vez de inventar una hora,
 * incluso el dia en que el sitio empiece a publicar fechas reales bajo este
 * diseño. Es una decision del sitio, no algo que este modulo pueda adivinar.
 *
 * Este modulo NO crea nada: interpreta y propone. Una fecha mal leida
 * programaria recordatorios reales en el dia equivocado para gente real, asi
 * que lo que sale de aqui siempre pasa por una confirmacion humana. Cuando algo
 * es ambiguo se dice, en lugar de adivinar.
 */
const MESES: Record<string, number> = {
  enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
  julio: 6, agosto: 7, septiembre: 8, setiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
};

/** Texto sin etiquetas, sin entidades y con espacios normalizados. */
export function limpiarTexto(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

const CAMPO_LEGACY = /class="dato__etiqueta">(.*?)<\/span>\s*<span class="dato__valor">(.*?)<\/span>/gs;

/**
 * Bloque de fecha del diseño actual: `tk-cta` es el hermano que viene justo
 * despues de `tk-dates` en la ficha publica, asi que delimita el bloque sin
 * tener que contar el cierre de divs anidados (fragil por regex). Si esa
 * marca cambiara, el bloque no cierra y el match simplemente no aparece:
 * `extraerCampoActual` devuelve `null` en vez de arrastrar el resto de la
 * pagina.
 */
const BLOQUE_FECHA_ACTUAL = /<div class="tk-dates">([\s\S]*?)<div class="tk-cta">/i;
const ETIQUETA_H3 = /<h3[^>]*>([\s\S]*?)<\/h3>/i;

function extraerCampoActual(html: string): { etiqueta: string; valor: string } | null {
  const bloque = html.match(BLOQUE_FECHA_ACTUAL);
  if (!bloque) return null;
  const contenido = bloque[1];
  const etiquetaMatch = contenido.match(ETIQUETA_H3);
  if (!etiquetaMatch) return null;
  const etiqueta = limpiarTexto(etiquetaMatch[1]);
  const valor = limpiarTexto(contenido.replace(ETIQUETA_H3, ""));
  return { etiqueta, valor };
}

/**
 * Pares etiqueta/valor de la ficha publica.
 *
 * Prueba el diseño legacy primero; el actual solo rellena "inicio" si el
 * legacy no lo encontro, y nunca pisa lo que el legacy ya haya leido. El
 * diseño actual no tiene un campo de horario equivalente (ver el comentario
 * del modulo): no se inventa uno.
 */
export function extraerCampos(html: string): Record<string, string> {
  const campos: Record<string, string> = {};
  for (const match of html.matchAll(CAMPO_LEGACY)) {
    const etiqueta = limpiarTexto(match[1]);
    const valor = limpiarTexto(match[2]);
    if (etiqueta) campos[etiqueta.toLowerCase()] = valor;
  }
  if (!campos.inicio) {
    const actual = extraerCampoActual(html);
    if (actual && /inicio/i.test(actual.etiqueta) && actual.valor) {
      campos.inicio = actual.valor;
    }
  }
  return campos;
}

export type HoraParseada = { hour: number; minute: number };

/**
 * "7:30-9:00 pm" -> inicio 19:30, fin 21:00.
 *
 * El sufijo am/pm de un rango se aplica a las dos horas, que es como lo lee
 * cualquier persona. Sin sufijo no se adivina: se devuelve `null` y el formulario
 * pide la hora, porque confundir 7:00 con 19:00 son doce horas de diferencia.
 */
export function parsearHorario(texto: string): { start: HoraParseada; end: HoraParseada | null } | null {
  const horas = [...texto.matchAll(/(\d{1,2}):(\d{2})/g)].map((m) => ({ hour: Number(m[1]), minute: Number(m[2]) }));
  if (horas.length === 0) return null;
  const sufijo = /\b(pm|p\.m\.)\b/i.test(texto) ? "pm" : /\b(am|a\.m\.)\b/i.test(texto) ? "am" : null;
  if (!sufijo && horas.every((h) => h.hour <= 12)) return null;

  const ajustar = (h: HoraParseada): HoraParseada => {
    if (h.hour > 23 || h.minute > 59) return h;
    if (sufijo === "pm" && h.hour < 12) return { hour: h.hour + 12, minute: h.minute };
    if (sufijo === "am" && h.hour === 12) return { hour: 0, minute: h.minute };
    return h;
  };

  const start = ajustar(horas[0]);
  const end = horas[1] ? ajustar(horas[1]) : null;
  if (start.hour > 23 || start.minute > 59) return null;
  return { start, end: end && end.hour <= 23 && end.minute <= 59 ? end : null };
}

export type FechasParseadas = { days: number[]; month: number; year: number };

/**
 * "11, 12, y 13 de Agosto" -> dias 11,12,13 del mes de agosto.
 *
 * La pagina no publica el año. Se toma el año en que esas fechas caen mas
 * cerca del presente sin quedar muy atras: un curso publicado hoy y fechado en
 * enero es del año que viene, no del pasado.
 */
export function parsearFechas(texto: string, ahora = new Date()): FechasParseadas | null {
  const match = texto.match(/([\d\s,y.]+?)\s*de\s+([a-zA-ZáéíóúÁÉÍÓÚ]+)/);
  if (!match) return null;
  const mes = MESES[match[2].toLowerCase()];
  if (mes === undefined) return null;

  const days = [...match[1].matchAll(/\d{1,2}/g)]
    .map((m) => Number(m[0]))
    .filter((day) => day >= 1 && day <= 31);
  if (days.length === 0) return null;

  // Un año explicito en el texto manda sobre cualquier deduccion.
  const anioExplicito = texto.match(/\b(20\d{2})\b/);
  if (anioExplicito) return { days: [...new Set(days)].sort((a, b) => a - b), month: mes, year: Number(anioExplicito[1]) };

  const anioActual = ahora.getUTCFullYear();
  const ultimo = new Date(Date.UTC(anioActual, mes, Math.max(...days), 23, 59));
  // Margen de un mes: un curso que empezo hace una semana sigue siendo de este
  // año; uno fechado dos meses atras casi seguro es del proximo.
  const year = ultimo.getTime() < ahora.getTime() - 31 * 24 * 3600 * 1000 ? anioActual + 1 : anioActual;
  return { days: [...new Set(days)].sort((a, b) => a - b), month: mes, year };
}

export type SesionPropuesta = { startAt: string; endAt: string | null };

export type PropuestaCalendario =
  | { ok: true; sessions: SesionPropuesta[]; fuenteInicio: string; fuenteHorario: string | null; horaAsumida: boolean }
  | { ok: false; motivo: string; fuenteInicio: string | null; fuenteHorario: string | null };

/** Offset de Ecuador. No tiene horario de verano, asi que es constante. */
const ECUADOR_OFFSET_MIN = -5 * 60;

function isoDesdeLocal(year: number, month: number, day: number, hour: number, minute: number): string {
  return new Date(Date.UTC(year, month, day, hour, minute) - ECUADOR_OFFSET_MIN * 60_000).toISOString();
}

/**
 * Propuesta de sesiones a partir del HTML de la ficha publica.
 *
 * Nunca devuelve una propuesta a medias: si falta la hora lo dice y deja que la
 * persona la escriba, porque una hora inventada es peor que ninguna.
 */
export function proponerCalendario(html: string, ahora = new Date()): PropuestaCalendario {
  const campos = extraerCampos(html);
  const inicio = campos.inicio ?? null;
  const horario = campos.horario ?? null;

  if (!inicio) return { ok: false, motivo: "La página del curso no publica el campo «Inicio».", fuenteInicio: null, fuenteHorario: horario };

  const fechas = parsearFechas(inicio, ahora);
  if (!fechas) {
    return {
      ok: false,
      // "Próximamente", "Reserva tu cupo": la web dice explicitamente que aun
      // no hay fecha. No es un fallo de lectura.
      motivo: `La página todavía no anuncia fechas («${inicio}»).`,
      fuenteInicio: inicio,
      fuenteHorario: horario,
    };
  }

  const hora = horario ? parsearHorario(horario) : null;
  if (!hora) {
    return {
      ok: false,
      motivo: horario
        ? `Se leyeron las fechas, pero el horario «${horario}» no indica si es mañana o tarde.`
        : "Se leyeron las fechas, pero la página no publica el horario.",
      fuenteInicio: inicio,
      fuenteHorario: horario,
    };
  }

  const sessions = fechas.days.map((day) => ({
    startAt: isoDesdeLocal(fechas.year, fechas.month, day, hora.start.hour, hora.start.minute),
    endAt: hora.end ? isoDesdeLocal(fechas.year, fechas.month, day, hora.end.hour, hora.end.minute) : null,
  }));

  return { ok: true, sessions, fuenteInicio: inicio, fuenteHorario: horario, horaAsumida: false };
}
