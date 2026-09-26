/**
 * Something the user ought to be told, from wherever it went wrong.
 *
 * Announced on the window rather than handed down through a context, because
 * a good half of the places that fail are not React: the editor's own drop
 * handler, the markdown extensions, the Vim command bar. This is the same
 * arrangement the sidebar already uses to hear about an attachment landing.
 *
 * Failures used to go to `console.error` and no further, which in a webview
 * with no devtools open means nowhere: a save that was refused looked exactly
 * like a save that worked.
 */
export const NOTICE_EVENT = "nuza-notice";

export interface Notice {
  id: number;
  /** What happened, in the app's own words. */
  message: string;
  /** What the thing that failed said about it, when it said anything. */
  reason?: string;
  /** Set while its exit animation runs, just before it is dropped. */
  leaving?: boolean;
}

/**
 * The message out of whatever was thrown. A Tauri command rejects with the
 * plain string its `Err` carried, and those are written for a reader - "a
 * file named x already exists" - so they are worth passing on rather than
 * replacing with something vaguer.
 */
export function reasonFor(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  const described = String(error);
  return described === "[object Object]" ? "" : described;
}

/**
 * Says that `message` happened, and why if `error` knows. Logged as well as
 * shown: a notice is gone in a few seconds and a console line is not.
 */
export function report(message: string, error?: unknown) {
  const reason = error === undefined ? "" : reasonFor(error);
  console.error(reason ? `${message}: ${reason}` : message, error);

  window.dispatchEvent(new CustomEvent(NOTICE_EVENT, { detail: { message, reason: reason || undefined } }));
}
