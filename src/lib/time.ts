export const ECUADOR_TIME_ZONE = "America/Guayaquil";
export const ECUADOR_UTC_OFFSET = "-05:00";

export function ecuadorLocalDateTimeToIso(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    throw new Error("Fecha y hora no válidas.");
  }
  const date = new Date(`${value}:00${ECUADOR_UTC_OFFSET}`);
  if (Number.isNaN(date.getTime())) throw new Error("Fecha y hora no válidas.");
  const localRoundTrip = new Date(date.getTime() - 5 * 60 * 60 * 1000).toISOString().slice(0, 16);
  if (localRoundTrip !== value) throw new Error("Fecha y hora no válidas.");
  return date.toISOString();
}

export function isoToEcuadorLocalInput(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - 5 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

export function ecuadorDayBounds(reference = new Date()): { start: Date; end: Date } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ECUADOR_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(reference);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  const date = `${value("year")}-${value("month")}-${value("day")}`;
  return {
    start: new Date(`${date}T00:00:00.000${ECUADOR_UTC_OFFSET}`),
    end: new Date(`${date}T23:59:59.999${ECUADOR_UTC_OFFSET}`),
  };
}
