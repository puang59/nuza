import { Text } from "@codemirror/state";

/**
 * The block of properties a note can carry at the very top, fenced by `---`.
 *
 * It is YAML rather than markdown, which is why it is pulled out of the
 * document by hand rather than read off the syntax tree: to the markdown parser
 * a `---` under a line of text is a heading underline, which is exactly how a
 * note's metadata ends up rendered as a run of enormous bold headings.
 */

/** How far down a closing fence is still believed to belong to the block. */
const SEARCH_LIMIT = 200;

export interface FrontmatterRange {
  /** Always 0 - a block only counts at the very top of the file. */
  from: number;
  /** End of the closing fence's line. */
  to: number;
  /** The closing fence's line number, which is where a new property goes. */
  closingLine: number;
}

export function frontmatterRange(doc: Text): FrontmatterRange | null {
  if (doc.lines < 2 || doc.line(1).text.trim() !== "---") return null;

  const furthest = Math.min(doc.lines, SEARCH_LIMIT);
  for (let number = 2; number <= furthest; number++) {
    const line = doc.line(number);
    if (line.text.trim() === "---") return { from: 0, to: line.to, closingLine: number };
  }

  return null;
}

export interface Property {
  key: string;
  value: string;
  /** Start of the line this came from, so a click can land the caret in it. */
  at: number;
}

const PROPERTY = /^([A-Za-z0-9_][\w .-]*)\s*:\s?(.*)$/;

/** Strips the quotes YAML allows around a scalar, and any trailing spaces. */
function unquote(value: string) {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if (trimmed.length >= 2 && (quote === '"' || quote === "'") && trimmed.endsWith(quote)) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * The `key: value` pairs in the block. A value written across following
 * indented lines - which is how YAML spells a list - is folded onto one line
 * for display; the source itself is never touched.
 */
export function frontmatterProperties(doc: Text, range: FrontmatterRange): Property[] {
  const properties: Property[] = [];

  for (let number = 2; number < range.closingLine; number++) {
    const line = doc.line(number);
    const match = PROPERTY.exec(line.text);

    if (match) {
      properties.push({ key: match[1].trim(), value: unquote(match[2]), at: line.from });
      continue;
    }

    // An indented line carries on the property above it.
    const previous = properties[properties.length - 1];
    const continuation = line.text.trim().replace(/^-\s*/, "");
    if (!previous || !continuation || !/^\s/.test(line.text)) continue;

    const folded = unquote(continuation);
    previous.value = previous.value ? `${previous.value}, ${folded}` : folded;
  }

  return properties;
}
