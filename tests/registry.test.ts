import { describe, expect, test } from "bun:test";
import { CORE, disposeAll, Registry } from "../src/lib/registries/registry";

interface Item {
  id: string;
  label?: string;
}

describe("a registry", () => {
  test("lists items in the order they were added", () => {
    const registry = new Registry<Item>();
    registry.register({ id: "b" });
    registry.register({ id: "a" });
    registry.register({ id: "c" });
    expect(registry.list().map((item) => item.id)).toEqual(["b", "a", "c"]);
  });

  test("refuses a second item under an id already taken", () => {
    const registry = new Registry<Item>();
    registry.register({ id: "a", label: "first" });
    expect(() => registry.register({ id: "a", label: "second" })).toThrow();
    expect(registry.get("a")?.label).toBe("first");
  });

  test("forgets an item when it is disposed, and only once", () => {
    const registry = new Registry<Item>();
    const added = registry.register({ id: "a" });
    let changes = 0;
    registry.subscribe(() => changes++);

    added.dispose();
    added.dispose();

    expect(registry.get("a")).toBeUndefined();
    expect(changes).toBe(1);
  });

  test("a stale handle does not remove an item added again under the same id", () => {
    const registry = new Registry<Item>();
    const first = registry.register({ id: "a", label: "first" });
    first.dispose();
    registry.register({ id: "a", label: "second" });

    first.dispose();

    expect(registry.get("a")?.label).toBe("second");
  });

  test("removes everything one owner added, and nothing else", () => {
    const registry = new Registry<Item>();
    registry.register({ id: "core-item" });
    registry.register({ id: "word-goal:one" }, "word-goal");
    registry.register({ id: "kanban:one" }, "kanban");
    registry.register({ id: "word-goal:two" }, "word-goal");

    registry.disposeOwner("word-goal");

    expect(registry.list().map((item) => item.id)).toEqual(["core-item", "kanban:one"]);
    expect(registry.ownerOf("core-item")).toBe(CORE);
    expect(registry.ownerOf("kanban:one")).toBe("kanban");
  });

  test("hands back the same list until something changes", () => {
    const registry = new Registry<Item>();
    registry.register({ id: "a" });
    const before = registry.list();
    expect(registry.list()).toBe(before);

    registry.register({ id: "b" });
    expect(registry.list()).not.toBe(before);

    const after = registry.list();
    registry.disposeOwner("nobody");
    expect(registry.list()).toBe(after);
  });

  test("tells its listeners about changes until they stop listening", () => {
    const registry = new Registry<Item>();
    let changes = 0;
    const stop = registry.subscribe(() => changes++);

    registry.register({ id: "a" });
    stop();
    registry.register({ id: "b" });

    expect(changes).toBe(1);
  });
});

describe("disposeAll", () => {
  test("undoes in reverse order, once", () => {
    const order: string[] = [];
    const all = disposeAll([{ dispose: () => order.push("first") }, { dispose: () => order.push("second") }]);

    all.dispose();
    all.dispose();

    expect(order).toEqual(["second", "first"]);
  });
});
