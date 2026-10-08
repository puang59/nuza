/**
 * How wide a picture is drawn, as the note itself says.
 *
 * The width is kept in the source, in the form other markdown tools already
 * read: after a bar in the alt text of an image - `![a dog|300](dog.png)` -
 * and after a bar in an embed - `![[dog.png|300]]`. Nothing about a picture's
 * size lives anywhere but in the note.
 */

/** The narrowest and widest a picture can be dragged to, in pixels. */
export const MIN_IMAGE_WIDTH = 48;
export const MAX_IMAGE_WIDTH = 4000;

export function clampImageWidth(width: number) {
  return Math.min(MAX_IMAGE_WIDTH, Math.max(MIN_IMAGE_WIDTH, Math.round(width)));
}

const SIZE_SUFFIX = /\|\s*(\d{1,4})\s*$/;

/** An image's alt text, and the width on the end of it if it carries one. */
export function readAltSize(alt: string): { alt: string; width: number | null } {
  const size = SIZE_SUFFIX.exec(alt);
  if (!size) return { alt, width: null };
  const width = Number(size[1]);
  return { alt: alt.slice(0, size.index).trimEnd(), width: width > 0 ? width : null };
}

/**
 * The source of an image or an embed, rewritten to carry `width` - or to
 * carry none, for null. Returns null for text that is neither, which is left
 * exactly as it is.
 */
export function withImageWidth(source: string, width: number | null): string | null {
  const size = width === null ? "" : `|${clampImageWidth(width)}`;

  if (source.startsWith("![[") && source.endsWith("]]")) {
    const inner = source.slice(3, -2);
    return `![[${inner.replace(SIZE_SUFFIX, "")}${size}]]`;
  }

  // `![alt](target)`: the alt runs to the last `](`, since it may hold a
  // bracket of its own.
  const close = source.lastIndexOf("](");
  if (!source.startsWith("![") || close < 2 || !source.endsWith(")")) return null;
  const alt = source.slice(2, close).replace(SIZE_SUFFIX, "");
  return `![${alt}${size}${source.slice(close)}`;
}
