import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { fakeTauriPage } from "./fakeTauri";

type State = { community: boolean; plugins: unknown[] };
let vaultState: State = { community: false, plugins: [] };
const calls: [string, unknown][] = [];

const restore = fakeTauriPage(
  (command, args) => {
    calls.push([command, args]);
    if (command === "plugins_state") return vaultState;
    if (command === "plugins_set_community") vaultState = { ...vaultState, community: !!args?.on };
    return null;
  },
  { IS_REACT_ACT_ENVIRONMENT: true }
);
afterAll(restore);

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: PluginSettings } = await import("../src/components/settings/PluginSettings");
const { plugins } = await import("../src/lib/plugins/loader");

let unmount = () => {};
afterEach(async () => {
  unmount();
  calls.length = 0;
  await plugins.unloadAll();
});

async function render(vaultPath: string | null) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<PluginSettings vaultPath={vaultPath} onOpenTab={() => {}} />));
  await act(async () => {
    await plugins.sync();
  });
  unmount = () => act(() => root.unmount());
  return container;
}

const wordGoal = {
  id: "word-goal",
  manifest: {
    id: "word-goal",
    name: "Word Goal",
    version: "1.2.0",
    minAppVersion: "3.0.0",
    apiVersion: 1,
    description: "A daily word target.",
    author: "Jane",
  },
  enabled: false,
  hasStyles: false,
  hash: "abc",
  problem: null,
  linked: false,
};

describe("the Community plugins pane", () => {
  test("says there is nothing without a folder", async () => {
    const pane = await render(null);
    expect(pane.textContent).toContain("Open a folder");
  });

  test("starts off, saying what turning plugins on means", async () => {
    vaultState = { community: false, plugins: [wordGoal] };
    const pane = await render("/vault");
    expect(pane.textContent).toContain("same access as nuza itself");
    expect(pane.textContent).not.toContain("Word Goal");

    const button = [...pane.querySelectorAll("button")].find(
      (b) => b.textContent === "Turn on community plugins"
    )!;
    await act(async () => button.click());
    await act(async () => {
      await plugins.sync();
    });

    expect(calls).toContainEqual(["plugins_set_community", { on: true }]);
    expect(pane.textContent).toContain("Word Goal");
  });

  test("lists installed plugins, with what stops one running", async () => {
    vaultState = {
      community: true,
      plugins: [
        wordGoal,
        {
          ...wordGoal,
          id: "too-new",
          manifest: { ...wordGoal.manifest, id: "too-new", name: "Too New" },
          problem: "Needs nuza 9.0.0 or newer",
        },
      ],
    };
    const pane = await render("/vault");
    expect(pane.textContent).toContain("Word Goal");
    expect(pane.textContent).toContain("v1.2.0");
    expect(pane.textContent).toContain("by Jane");
    expect(pane.textContent).toContain("Needs nuza 9.0.0 or newer");
  });
});
