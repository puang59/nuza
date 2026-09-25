/**
 * The editable bits inside a rendered block - a property's value, a table cell.
 *
 * These are real form controls rather than `contenteditable` spans, and that is
 * the whole trick: a caret inside an `input` is the control's own, invisible to
 * the document selection CodeMirror keeps in step with the DOM. A
 * contenteditable island would put the caret *in* the editor's selection, and
 * the two would spend every keystroke arguing about where it belongs.
 *
 * CodeMirror ignores DOM changes inside a widget altogether, so nothing typed
 * here reaches the document except through the edit each field dispatches.
 */

export interface FieldOptions {
  className: string;
  value: string;
  /** Called on every keystroke, with the field's current contents. */
  onInput: (value: string) => void;
  /** Called when the field is done with - Enter, or Tab out of it. */
  onCommit?: () => void;
  placeholder?: string;
}

/** Grows a textarea to fit what it holds, so a long value wraps rather than scrolls. */
function fit(field: HTMLTextAreaElement) {
  field.style.height = "auto";
  field.style.height = `${field.scrollHeight}px`;
}

function shared(field: HTMLInputElement | HTMLTextAreaElement, options: FieldOptions) {
  field.className = options.className;
  field.value = options.value;
  field.spellcheck = false;
  if (options.placeholder) field.placeholder = options.placeholder;

  // Nothing typed in here is meant for the editor: not the keys Vim is
  // listening for, not the Enter that would continue a list.
  // A union of two element types loses the typed listener overloads, hence
  // the cast; the event is a keydown either way.
  field.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if ((event as KeyboardEvent).key === "Escape") {
      event.preventDefault();
      field.blur();
    }
  });

  field.addEventListener("mousedown", (event) => event.stopPropagation());
  field.addEventListener("input", () => options.onInput(field.value));
}

export function textField(options: FieldOptions) {
  const field = document.createElement("input");
  field.type = "text";
  shared(field, options);

  field.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      options.onCommit?.();
    }
  });

  return field;
}

/**
 * A value that can run long. Enter finishes it rather than adding a line:
 * these are single-line YAML scalars, and a newline would break the block.
 */
export function areaField(options: FieldOptions) {
  const field = document.createElement("textarea");
  field.rows = 1;
  shared(field, options);

  field.addEventListener("input", () => fit(field));
  field.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      options.onCommit?.();
    }
  });

  // The element has no size until it is in the document, so the first fit has
  // to wait for it to be there.
  requestAnimationFrame(() => fit(field));
  return field;
}

/**
 * Puts `value` into a field that the user is not currently typing in. Writing
 * to the focused one would throw its caret back to the end mid-word.
 */
export function refresh(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  if (document.activeElement === field || field.value === value) return;
  field.value = value;
  if (field instanceof HTMLTextAreaElement) fit(field);
}
