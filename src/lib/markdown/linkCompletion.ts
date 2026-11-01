import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { NOTE_PATTERN } from "../fileIndex";
import { vaultFiles } from "./embedIndex";
import { noteDirectory } from "./sources";
import { wikiTargetFor } from "./wikiLinks";

/** Code, where `[[` is an array and not a link. */
const CODE = new Set(["FencedCode", "CodeBlock", "InlineCode", "CodeText"]);

/** What can be typed between `[[` and the end of the name: no brackets, no label, no heading yet. */
const NAME_SO_FAR = /\[\[[^[\]\n|#]*$/;

interface NoteCompletion extends Completion {
  path: string;
}

/** The suggestions for one list of files, kept until the vault's list changes. */
let cached: { files: readonly string[]; notes: string[]; options: NoteCompletion[] } | null = null;

function suggestions() {
  const { files } = vaultFiles();
  if (cached?.files === files) return cached;

  const notes = files.filter((path) => NOTE_PATTERN.test(path));
  const { root } = vaultFiles();
  const options = notes.map((path): NoteCompletion => {
    const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    const folder = path
      .slice(0, slash)
      .slice(root.length)
      .replace(/^[/\\]+/, "");
    return { label: path.slice(slash + 1).replace(NOTE_PATTERN, ""), detail: folder, path, apply: applyNote };
  });
  cached = { files, notes, options };
  return cached;
}

/**
 * Writes the chosen note between the brackets - by name, or by path where
 * another note of that name would be found first - and puts the caret after
 * the `]]`, closing them if they were not already.
 */
function applyNote(view: EditorView, completion: Completion, from: number, to: number) {
  const { root } = vaultFiles();
  const { notes } = suggestions();
  const target = wikiTargetFor(
    (completion as NoteCompletion).path,
    notes,
    root,
    view.state.facet(noteDirectory)
  );
  const closed = view.state.sliceDoc(to, to + 2) === "]]";
  view.dispatch({
    changes: { from, to, insert: closed ? target : `${target}]]` },
    selection: { anchor: from + target.length + 2 },
    userEvent: "input.complete",
  });
}

/**
 * `[[` offers the vault's notes, narrowed as the name is typed, the way a
 * wiki-link is written in every other notes app. Choosing one fills in the
 * name and steps out of the brackets.
 */
function noteLinks(context: CompletionContext): CompletionResult | null {
  const typed = context.matchBefore(NAME_SO_FAR);
  if (!typed || context.state.sliceDoc(typed.from - 1, typed.from) === "!") return null;

  for (
    let node: SyntaxNode | null = syntaxTree(context.state).resolveInner(context.pos, -1);
    node;
    node = node.parent
  ) {
    if (CODE.has(node.name)) return null;
  }

  const { options } = suggestions();
  if (!options.length) return null;
  return {
    from: typed.from + 2,
    options,
    validFor: /^[^[\]\n|#]*$/,
  };
}

export const noteLinkCompletion = EditorState.languageData.of(() => [{ autocomplete: noteLinks }]);
