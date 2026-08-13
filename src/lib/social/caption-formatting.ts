export type SocialCopyStyle = "plain" | "bold" | "italic";

export type SocialCopySegment = {
  text: string;
  style: SocialCopyStyle;
};

function isWordCharacter(value: string | undefined): boolean {
  return Boolean(value && /[\p{L}\p{N}]/u.test(value));
}

function canOpen(text: string, index: number, marker: string): boolean {
  const previous = text[index - 1];
  const next = text[index + marker.length];
  if (!next || /\s/.test(next)) return false;
  if (isWordCharacter(previous)) return false;
  return previous !== "/" && previous !== ":";
}

function findClosing(text: string, index: number, marker: string): number {
  let closing = text.indexOf(marker, index + marker.length);
  while (closing >= 0) {
    const before = text[closing - 1];
    const after = text[closing + marker.length];
    if (before && !/\s/.test(before) && !isWordCharacter(after)) return closing;
    closing = text.indexOf(marker, closing + marker.length);
  }
  return -1;
}

function append(segments: SocialCopySegment[], text: string, style: SocialCopyStyle) {
  if (!text) return;
  const previous = segments.at(-1);
  if (previous?.style === style) previous.text += text;
  else segments.push({ text, style });
}

/**
 * Reconoce solamente el Markdown visual que el compositor soporta. Es
 * deliberadamente conservador: guiones bajos dentro de URLs, hashtags o
 * palabras no se interpretan como formato.
 */
export function parseSocialCopy(text: string): SocialCopySegment[] {
  const segments: SocialCopySegment[] = [];
  let plainStart = 0;
  let index = 0;

  while (index < text.length) {
    const marker = text.startsWith("**", index)
      ? "**"
      : text.startsWith("__", index)
        ? "__"
        : text[index] === "*"
          ? "*"
          : text[index] === "_"
            ? "_"
            : null;

    if (!marker || !canOpen(text, index, marker)) {
      index++;
      continue;
    }

    const closing = findClosing(text, index, marker);
    if (closing < 0) {
      index++;
      continue;
    }

    append(segments, text.slice(plainStart, index), "plain");
    append(segments, text.slice(index + marker.length, closing), marker.length === 2 ? "bold" : "italic");
    index = closing + marker.length;
    plainStart = index;
  }

  append(segments, text.slice(plainStart), "plain");
  return segments;
}

/** Texto compatible con captions de Meta, sin marcadores Markdown visibles. */
export function normalizeSocialCaption(text: string): string {
  return parseSocialCopy(text).map((segment) => segment.text).join("");
}
