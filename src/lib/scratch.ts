import { isMainWindow } from "./windowLabel";

/**
 * The untitled notes - the scratch note and any made with "New Note" that
 * have not been saved yet - kept between runs and across vault switches.
 *
 * Every other document in the editor has a file behind it. An untitled one
 * has nowhere to be written, which is why autosave steps over it - and why
 * opening a vault, or closing the app, used to be enough to lose whatever was
 * in it. It is kept here instead, beside the session, rather than by turning
 * it into a file on disk nobody asked for.
 */
const STORAGE_KEY = "nuza:scratch";

/**
 * Only the first window has one. The store is shared by every window of the
 * app, and two windows each keeping their own untitled notes would write over
 * one another and neither would be the notes it left. The others start
 * empty, and what is typed in them is not kept - a note worth keeping is one
 * that has been saved to a file.
 */
const ownsScratch = isMainWindow;

/** Every untitled note kept from last time, by the path its tab holds, or none if there weren't any. */
export function readScratch(): Record<string, string> {
  if (!ownsScratch()) return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Keeps every note in `drafts`. None left with anything in them forgets the entry rather than storing "{}". */
export function writeScratch(drafts: Readonly<Record<string, string>>) {
  if (!ownsScratch()) return;
  try {
    const present = Object.fromEntries(Object.entries(drafts).filter(([, content]) => content));
    if (Object.keys(present).length > 0) localStorage.setItem(STORAGE_KEY, JSON.stringify(present));
    else localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error("Failed to keep the untitled notes:", error);
  }
}
