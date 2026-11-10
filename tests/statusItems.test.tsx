import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import AddedStatusItems from "../src/components/AddedStatusItems";
import { useStatusItems } from "../src/hooks/useStatusItems";
import { statusItems } from "../src/lib/registries/statusItems";

let root: Root | null = null;
let container: HTMLElement;

const replaced = [
  "window",
  "document",
  "localStorage",
  "HTMLElement",
  "Element",
  "Event",
  "CustomEvent",
  "IS_REACT_ACT_ENVIRONMENT",
];
let before: [string, PropertyDescriptor | undefined][] = [];

beforeAll(() => {
  before = replaced.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const window = new Window();
  Object.assign(globalThis, {
    window,
    document: window.document,
    localStorage: window.localStorage,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Event: window.Event,
    CustomEvent: window.CustomEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
});

afterAll(() => {
  for (const [key, descriptor] of before) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete (globalThis as Record<string, unknown>)[key];
  }
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  statusItems.disposeOwner("word-goal");
  localStorage.clear();
});

function render(node: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
}

function wordGoal(log: string[]) {
  return statusItems.register(
    {
      id: "word-goal:progress",
      label: "Word Goal",
      mount(el) {
        el.textContent = "120 / 500";
        log.push("mounted");
        return () => log.push("cleaned up");
      },
    },
    "word-goal"
  );
}

describe("an added footer item", () => {
  test("is given its own element, and is cleaned up when taken away", () => {
    const log: string[] = [];
    const added = wordGoal(log);
    render(<AddedStatusItems shows={() => true} />);

    expect(container.querySelector('[data-status-item="word-goal:progress"]')?.textContent).toBe("120 / 500");

    act(() => added.dispose());
    expect(container.querySelector("[data-status-item]")).toBeNull();
    expect(log).toEqual(["mounted", "cleaned up"]);
  });

  test("is left out while hidden", () => {
    wordGoal([]);
    render(<AddedStatusItems shows={(id) => id !== "word-goal:progress"} />);
    expect(container.querySelector("[data-status-item]")).toBeNull();
  });

  test("that fails to draw does not take the footer down", () => {
    statusItems.register(
      {
        id: "word-goal:broken",
        label: "Broken",
        mount() {
          throw new Error("no");
        },
      },
      "word-goal"
    );
    render(<AddedStatusItems shows={() => true} />);
    expect(container.querySelector('[data-status-item="word-goal:broken"]')).not.toBeNull();
  });
});

describe("the footer's right-click menu", () => {
  function MenuLabels() {
    const { menuItems } = useStatusItems(["words"]);
    return <>{menuItems.map((item) => `${item.label}:${item.checked}`).join(",")}</>;
  }

  test("offers added items after the footer's own", () => {
    wordGoal([]);
    render(<MenuLabels />);
    expect(container.textContent).toBe("Words:true,Word Goal:true");
  });
});
