import { EditorState, Extension, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/**
 * How much of the pane is kept clear above and below the caret, in pixels.
 * The editor only scrolls when the caret would leave the pane, which left the
 * line being written pressed against its bottom edge - or, coming back up,
 * against the top - with nothing of what follows in sight.
 */
export const SCROLL_MARGIN = 56;

/** A few lines of the note always showing either side of the caret. */
export const scrollMargin: Extension = EditorView.scrollMargins.of(() => ({
  top: SCROLL_MARGIN,
  bottom: SCROLL_MARGIN,
}));

/**
 * Whether a transaction is the caret being moved from the keyboard, or the
 * note being typed in - the moves a typewriter follows. A click or a drag is
 * not one: the place clicked is already where the eye is, and sliding the
 * page out from under the pointer is the opposite of what was asked for.
 */
export function followsCaret(transaction: Transaction) {
  if (!transaction.selection && !transaction.docChanged) return false;
  if (transaction.isUserEvent("select.pointer")) return false;
  return (
    transaction.isUserEvent("input") ||
    transaction.isUserEvent("delete") ||
    transaction.isUserEvent("select") ||
    transaction.isUserEvent("move") ||
    transaction.isUserEvent("undo") ||
    transaction.isUserEvent("redo")
  );
}

/**
 * Typewriter scrolling: the line being written stays at the middle of the
 * pane and the note moves under it, so the eye stays where it is. Each move
 * of the caret from the keyboard carries a scroll to centre it.
 */
export const typewriterScrolling: Extension = EditorState.transactionExtender.of((transaction) => {
  if (!followsCaret(transaction)) return null;
  return { effects: EditorView.scrollIntoView(transaction.newSelection.main.head, { y: "center" }) };
});
