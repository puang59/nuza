import { afterEach, describe, expect, test } from "bun:test";
import { Compartment, EditorState, Facet } from "@codemirror/state";
import { addedExtensions, editorExtensions } from "../src/lib/registries/editorExtensions";

const marker = Facet.define<string>();

afterEach(() => editorExtensions.disposeOwner("word-goal"));

describe("added editor extensions", () => {
  test("are one value until something is added or taken away", () => {
    const before = addedExtensions();
    expect(addedExtensions()).toBe(before);

    const added = editorExtensions.register({ id: "word-goal:a", extension: marker.of("a") }, "word-goal");
    const after = addedExtensions();
    expect(after).not.toBe(before);
    expect(addedExtensions()).toBe(after);

    added.dispose();
    expect(addedExtensions()).not.toBe(after);
  });

  test("reach a document through its compartment, and leave it the same way", () => {
    const additions = new Compartment();
    let state = EditorState.create({ extensions: additions.of(addedExtensions()) });
    expect(state.facet(marker)).toEqual([]);

    const added = editorExtensions.register({ id: "word-goal:a", extension: marker.of("a") }, "word-goal");
    state = state.update({ effects: additions.reconfigure(addedExtensions()) }).state;
    expect(state.facet(marker)).toEqual(["a"]);

    added.dispose();
    state = state.update({ effects: additions.reconfigure(addedExtensions()) }).state;
    expect(state.facet(marker)).toEqual([]);
  });
});
