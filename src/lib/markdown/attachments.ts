import { Facet } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  MEDIA_FOLDER,
  announceAttachment,
  encodeLinkTarget,
  fileNameOf,
  isImage,
  joinPath,
  pastedName,
  relativePath,
  writeMedia,
} from "../media";
import { noteDirectory } from "./sources";

/**
 * The open folder. Attachments are filed in a `media` directory here rather
 * than beside whichever note happens to be open, so moving a note around the
 * vault does not scatter its images behind it.
 */
export const vaultDirectory = Facet.define<string, string>({
  combine: (values) => (values.length ? values[values.length - 1] : ""),
});

/** While a file is being dragged over the editor, for the drop outline. */
const DRAGGING_CLASS = "cm-drop-target";

/**
 * The element the outline is drawn on. The editor itself is pinned by a handful
 * of `!important` rules in the stylesheet, so the indicator goes on the frame
 * around it instead of fighting them.
 */
function dropZone(view: EditorView) {
  return view.dom.parentElement ?? view.dom;
}

/**
 * The files carried by a paste or a drop. A screenshot on the clipboard is raw
 * bytes rather than a file on disk, and WebKit leaves `files` empty for those -
 * the same image is in `items`, which is where every browser puts it.
 */
function filesFrom(transfer: DataTransfer | null) {
  if (!transfer) return [];

  const dropped = Array.from(transfer.files);
  if (dropped.length) return dropped;

  return Array.from(transfer.items)
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}

/** Names browsers invent for clipboard images, which carry no information. */
const PLACEHOLDER_NAMES = new Set(["", "image.png", "image.jpeg", "image.jpg", "unknown"]);

function nameFor(file: File) {
  return PLACEHOLDER_NAMES.has(file.name.toLowerCase()) ? pastedName(file.type) : file.name;
}

/** What to write into the note for a file that has just been saved. */
function linkFor(saved: string, directory: string, type: string) {
  const target = encodeLinkTarget(relativePath(directory, saved));
  const name = fileNameOf(saved);
  return isImage(type) ? `![${name}](${target})` : `[${name}](${target})`;
}

/**
 * Files their contents under the vault's media folder and writes a link to
 * each one into the note, in the order they were dropped.
 */
async function attach(view: EditorView, files: File[], at: number) {
  const vault = view.state.facet(vaultDirectory);
  const note = view.state.facet(noteDirectory);
  // Somewhere to put it and something to resolve it against: without an open
  // folder there is no vault to file anything in.
  const base = vault || note;
  if (!base) return;

  const directory = joinPath(base, MEDIA_FOLDER);
  let position = Math.min(at, view.state.doc.length);

  for (const file of files) {
    try {
      const saved = await writeMedia(directory, nameFor(file), file);
      announceAttachment(saved);

      const link = linkFor(saved, note || base, file.type);
      // The link gets a line of its own, and the caret is left on the line
      // after it - an image only renders once the caret is off its line, and
      // what you want to see having just dropped one in is the picture.
      const onOwnLine = position === 0 || view.state.doc.sliceString(position - 1, position) === "\n";
      const insert = `${onOwnLine ? "" : "\n"}${link}\n`;

      view.dispatch({
        changes: { from: position, insert },
        selection: { anchor: position + insert.length },
        scrollIntoView: true,
      });
      position += insert.length;
    } catch (error) {
      console.error("Failed to attach file:", error);
    }
  }

  view.focus();
}

/**
 * Screenshots and files, dropped onto the note or pasted into it. The clipboard
 * hands over the same kind of object a drop does, so both routes end up filing
 * the bytes the same way; the only difference is where the link goes.
 */
export const attachments = EditorView.domEventHandlers({
  paste(event, view) {
    const files = filesFrom(event.clipboardData);
    // Copying text out of a rich app can carry an image of it along too, so
    // only the clipboards that are *only* files are treated as attachments.
    if (!files.length || !files.some((file) => isImage(file.type))) return false;

    event.preventDefault();
    void attach(view, files, view.state.selection.main.from);
    return true;
  },

  drop(event, view) {
    const files = filesFrom(event.dataTransfer);
    dropZone(view).classList.remove(DRAGGING_CLASS);
    if (!files.length) return false;

    event.preventDefault();
    const at = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.from;
    void attach(view, files, at);
    return true;
  },

  dragover(event, view) {
    if (!event.dataTransfer?.types.includes("Files")) return false;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    dropZone(view).classList.add(DRAGGING_CLASS);
    return false;
  },

  dragleave(event, view) {
    // Moving between elements inside the editor fires this too; only a pointer
    // that has actually left the editor should put the outline away.
    if (dropZone(view).contains(event.relatedTarget as Node | null)) return false;
    dropZone(view).classList.remove(DRAGGING_CLASS);
    return false;
  },
});
