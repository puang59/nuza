/**
 * The words the writer has told the spell checker to accept, kept in
 * localStorage so they outlive the app and are shared by every window.
 */

export const USER_WORDS_KEY = "spellcheckWords";

export function readUserWords(): string[] {
  try {
    const saved = localStorage.getItem(USER_WORDS_KEY);
    const parsed: unknown = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed) ? parsed.filter((word): word is string => typeof word === "string") : [];
  } catch {
    return [];
  }
}

/** Adds `word` to the list, once; true when it was new. */
export function addUserWord(word: string) {
  const words = readUserWords();
  if (words.some((known) => known.toLowerCase() === word.toLowerCase())) return false;

  try {
    localStorage.setItem(USER_WORDS_KEY, JSON.stringify([...words, word]));
  } catch (error) {
    console.error("Failed to store the personal dictionary:", error);
  }
  return true;
}

/** Calls `listener` when another window adds a word. Returns the way to stop. */
export function onUserWordsChanged(listener: () => void) {
  function onStorage(event: StorageEvent) {
    if (event.storageArea === localStorage && event.key === USER_WORDS_KEY) listener();
  }
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}
