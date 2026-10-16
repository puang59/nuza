import { createSpeller, Speller } from "./spelling";
import { readUserWords } from "./userDictionary";

export type SpellLanguage = "en-US" | "en-GB";

export const SPELL_LANGUAGES: { id: SpellLanguage; label: string }[] = [
  { id: "en-US", label: "English (US)" },
  { id: "en-GB", label: "English (UK)" },
];

export const DEFAULT_SPELL_LANGUAGE: SpellLanguage = "en-US";

/**
 * Each dictionary is its own chunk, fetched the first time spelling is
 * switched on for it - half a megabyte that a writer who never turns spell
 * check on does not carry. The paths go through `node_modules` directly
 * because the dictionary packages export only their JavaScript entry point.
 */
const sources: Record<SpellLanguage, () => Promise<[string, string]>> = {
  "en-US": async () => {
    const [aff, dic] = await Promise.all([
      import("../../node_modules/dictionary-en/index.aff?raw"),
      import("../../node_modules/dictionary-en/index.dic?raw"),
    ]);
    return [aff.default, dic.default];
  },
  "en-GB": async () => {
    const [aff, dic] = await Promise.all([
      import("../../node_modules/dictionary-en-gb/index.aff?raw"),
      import("../../node_modules/dictionary-en-gb/index.dic?raw"),
    ]);
    return [aff.default, dic.default];
  },
};

const loaded = new Map<SpellLanguage, Promise<Speller>>();

/** The speller for `language`, built once and shared by every editor. */
export function loadSpeller(language: SpellLanguage) {
  let speller = loaded.get(language);
  if (!speller) {
    speller = sources[language]().then(
      ([aff, dic]) => createSpeller(aff, dic, readUserWords()),
      (error) => {
        // Let a later attempt try again rather than caching the failure.
        loaded.delete(language);
        throw error;
      }
    );
    loaded.set(language, speller);
  }
  return speller;
}
