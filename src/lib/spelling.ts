import NSpell from "nspell";

/**
 * Deciding which words in a piece of prose are misspelled.
 *
 * A dictionary alone makes a poor checker for notes: they are full of file
 * names, handles, identifiers, acronyms and product names, every one of which
 * a dictionary calls wrong. Most of what makes this accurate is therefore
 * deciding what is *not* a word to be checked - that is `tokens`. The
 * dictionary, in `createSpeller`, only answers for what is left.
 *
 * Nothing here touches the editor, so all of it can be tried on plain strings.
 */

/** A run of letters, with the apostrophes and hyphens that join them: `don't`, `well-known`. */
const WORD = /[\p{Script=Latin}\p{M}]+(?:['’-][\p{Script=Latin}\p{M}]+)*/gu;

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const LOWER_THEN_UPPER = /\p{Ll}\p{Lu}/u;
const ALL_CAPS = /^\p{Lu}+$/u;
/** A word's own neighbours that mean it is part of something else: `@name`, `a/b/c`, `v2`. */
const GLUED_BEFORE = /[\p{N}@/\\$]/u;
const GLUED_AFTER = /[\p{N}@\\]/u;
/** What ends the thing a word might be part of: a space, or the brackets of a link or tag around it. */
const CHUNK_EDGE = /[\s()[\]<>"]/;
/** How far from a word to look for the rest of the thing it might be part of. */
const CHUNK_REACH = 120;

export interface Token {
  from: number;
  to: number;
  text: string;
}

/**
 * Whether the stretch of non-space characters a word sits in is a URL, an
 * address, a path or a file name rather than a sentence - in which case none
 * of the words in it are the writer's to have spelled.
 */
function looksTechnical(chunk: string) {
  if (chunk.includes("://") || /^www\./i.test(chunk)) return true;
  if (chunk.includes("@") || chunk.includes("\\")) return true;
  // `snake_case`, but not `_emphasis_`.
  if (/[\p{L}\p{N}]_[\p{L}\p{N}]/u.test(chunk)) return true;
  // `src/lib/x`, `/etc`, `~/notes`, `./a`. A single slash is left alone: `and/or`.
  if (/^[~.]?\//.test(chunk) || (chunk.match(/\//g)?.length ?? 0) >= 2) return true;
  // `file.txt`, `example.com`, `Node.js`: a dot with a letter or digit on each side.
  if (/[\p{L}\p{N}]\.[\p{L}\p{N}]/u.test(chunk)) return true;
  return false;
}

/**
 * The words in `text` that are worth checking, with where they are.
 *
 * Left out: single letters; anything with a digit, underscore or `@` stuck to
 * it; `camelCase`, `PascalCase` and `iPhone`; ACRONYMS; and everything in a
 * URL, path, address or file name. Only Latin script is looked at - a note in
 * another script is not this dictionary's to judge.
 */
export function tokens(text: string, offset = 0): Token[] {
  const found: Token[] = [];

  for (const match of text.matchAll(WORD)) {
    const word = match[0];
    const from = match.index;
    const to = from + word.length;

    if (word.length < 2) continue;
    if (LOWER_THEN_UPPER.test(word) || ALL_CAPS.test(word.replace(/['’-]/g, ""))) continue;

    const before = from > 0 ? text[from - 1] : "";
    const after = to < text.length ? text[to] : "";
    // A digit or a letter of another script touching it makes it half of
    // something this dictionary can't read: `h2o`, `日本abc`.
    if (before && (GLUED_BEFORE.test(before) || LETTER_OR_DIGIT.test(before))) continue;
    if (after && (GLUED_AFTER.test(after) || LETTER_OR_DIGIT.test(after))) continue;

    let start = from;
    while (start > 0 && from - start < CHUNK_REACH && !CHUNK_EDGE.test(text[start - 1])) start--;
    let end = to;
    while (end < text.length && end - to < CHUNK_REACH && !CHUNK_EDGE.test(text[end])) end++;
    if (looksTechnical(text.slice(start, end))) continue;

    found.push({ from: offset + from, to: offset + to, text: word });
  }

  return found;
}

/** `suggestion` written the way `original` is: `Teh` → `The`, `TEH` → `THE`. */
export function matchCase(suggestion: string, original: string) {
  if (original.length > 1 && ALL_CAPS.test(original)) return suggestion.toUpperCase();
  const first = original[0];
  if (first && first !== first.toLowerCase() && first === first.toUpperCase()) {
    return suggestion[0].toUpperCase() + suggestion.slice(1);
  }
  return suggestion;
}

/**
 * Words that turn up constantly in notes and that the dictionaries, which are
 * of general English, don't hold. Kept to everyday computing: anything more
 * specialised is for the writer's own dictionary.
 */
const EVERYDAY_TECH = [
  "nuza",
  "ok",
  "todo",
  "todos",
  "github",
  "url",
  "urls",
  "api",
  "apis",
  "html",
  "css",
  "json",
  "yaml",
  "cli",
  "gui",
  "backend",
  "frontend",
  "webhook",
  "repo",
  "repos",
  "config",
  "autosave",
  "async",
  "macos",
  "ios",
  "iphone",
  "javascript",
  "typescript",
  "dev",
  "param",
  "params",
  "wifi",
  "signup",
  "readme",
  "changelog",
  "dropdown",
  "checkboxes",
  "autocomplete",
  "lookups",
];

/**
 * How many single-letter edits - a letter added, dropped, changed, or two
 * neighbours swapped - turn `a` into `b`. The dictionary's own suggestions
 * arrive in an order that puts `ten` ahead of `the` for `teh`; this is what
 * puts them in the order a person would.
 */
export function editDistance(a: string, b: string) {
  const rows: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    rows.push(new Array<number>(b.length + 1).fill(0));
    rows[i][0] = i;
  }
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
      }
    }
  }
  return rows[a.length][b.length];
}

export interface Speller {
  /**
   * The parts of `word` (a token from `tokens`) that are misspelled, as
   * offsets into it. Empty when it is fine. A hyphenated word is judged part
   * by part, so only the part that is wrong is underlined.
   */
  misspelled(word: string): [number, number][];
  /** Likely corrections, best first, written in the case of `word`. */
  suggest(word: string): string[];
  /** Accept `word` from now on, without keeping it anywhere. */
  ignore(word: string): void;
}

/** Normalised so a curly apostrophe finds the dictionary's straight one. */
function plain(word: string) {
  return word.replace(/’/g, "'");
}

/**
 * A speller over a Hunspell dictionary. `own` is the writer's personal words,
 * which are accepted in any capitalisation; the returned speller's `ignore`
 * adds to the same set.
 */
export function createSpeller(aff: string, dic: string, own: Iterable<string> = []): Speller {
  const dictionary = NSpell(aff, dic);
  const accepted = new Set<string>(EVERYDAY_TECH);
  for (const word of own) accepted.add(plain(word).toLowerCase());

  /** Lookups remembered: the same few words come round again and again. */
  const memo = new Map<string, boolean>();

  function known(word: string): boolean {
    const key = plain(word);
    if (accepted.has(key.toLowerCase())) return true;

    let result = memo.get(key);
    if (result === undefined) {
      result = dictionary.correct(key);
      // `Nuza's` is as right as `Nuza` is: the dictionary only knows to allow
      // a possessive on the words it holds.
      if (!result && /'s$/i.test(key)) result = accepted.has(key.slice(0, -2).toLowerCase());
      memo.set(key, result);
    }
    return result;
  }

  return {
    misspelled(word) {
      if (known(word)) return [];
      if (!word.includes("-")) return [[0, word.length]];

      const wrong: [number, number][] = [];
      let at = 0;
      for (const part of word.split("-")) {
        if (part.length >= 2 && !known(part)) wrong.push([at, at + part.length]);
        at += part.length + 1;
      }
      return wrong;
    },

    suggest(word) {
      const key = plain(word);
      const lower = key.toLowerCase();

      // Two letters the wrong way round is the commonest slip, and the
      // dictionary's search is the worst at finding it.
      const swapped: string[] = [];
      for (let i = 0; i < lower.length - 1; i++) {
        const candidate = lower.slice(0, i) + lower[i + 1] + lower[i] + lower.slice(i + 2);
        if (candidate !== lower && dictionary.correct(candidate)) swapped.push(candidate);
      }

      // The same few results in different cases (`Ok`, `ok`) read as noise, and
      // so do acronyms offered for a word that was not written as one.
      const seen = new Set<string>();
      const options: { text: string; distance: number }[] = [];
      for (const suggestion of [...swapped, ...dictionary.suggest(key)]) {
        if (ALL_CAPS.test(suggestion) && suggestion.length > 1 && !ALL_CAPS.test(key)) continue;
        const cased = matchCase(suggestion, key);
        if (cased === key || seen.has(cased.toLowerCase())) continue;
        seen.add(cased.toLowerCase());
        options.push({ text: cased, distance: editDistance(lower, suggestion.toLowerCase()) });
      }

      // Stable: among equally close ones the dictionary's own order stands.
      return options.sort((a, b) => a.distance - b.distance).map((option) => option.text);
    },

    ignore(word) {
      accepted.add(plain(word).toLowerCase());
    },
  };
}
