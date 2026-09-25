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
  /** The key's own text, so editing a field can write back over just the key. */
  keyFrom: number;
  keyTo: number;
  /**
   * The value's text, inside its quotes where it has them - so typing into the
   * field replaces what the value says without disturbing how it is written.
   */
  valueFrom: number;
  valueTo: number;
}

/** A key has to look like a name, or `https://x` would read as one. */
const KEY = /^[A-Za-z0-9_][\w .-]*$/;

/**
 * The properties in the block, or null if it holds anything a two-column form
 * cannot honestly represent - nesting, lists, a value carried across lines.
 * Those blocks are left as text rather than shown as something they are not.
 */
export function readFrontmatter(doc: Text, range: FrontmatterRange): Property[] | null {
  const properties: Property[] = [];

  for (let number = 2; number < range.closingLine; number++) {
    const line = doc.line(number);
    if (!line.text.trim()) continue;

    const colon = line.text.indexOf(":");
    if (colon < 0) return null;

    const rawKey = line.text.slice(0, colon);
    if (!KEY.test(rawKey)) return null;

    const rawValue = line.text.slice(colon + 1);
    const indent = rawValue.length - rawValue.trimStart().length;
    const trimmed = rawValue.trim();

    // An empty value is where a list or a nested block would hang off, and
    // neither belongs in a form.
    if (!trimmed && number + 1 < range.closingLine && /^\s+\S/.test(doc.line(number + 1).text)) return null;

    let valueFrom = line.from + colon + 1 + indent;
    let valueTo = valueFrom + trimmed.length;
    let value = trimmed;

    const quote = trimmed[0];
    if (trimmed.length >= 2 && (quote === '"' || quote === "'") && trimmed.endsWith(quote)) {
      value = trimmed.slice(1, -1);
      valueFrom += 1;
      valueTo -= 1;
    }

    properties.push({
      key: rawKey.trim(),
      value,
      keyFrom: line.from,
      keyTo: line.from + rawKey.trimEnd().length,
      valueFrom,
      valueTo,
    });
  }

  return properties;
}
