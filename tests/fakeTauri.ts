import { Window } from "happy-dom";

type Invoke = (command: string, args?: Record<string, unknown>) => unknown;

/**
 * A happy-dom page as the global window, with Tauri faked the way the real
 * `@tauri-apps/api` reaches it, through `window.__TAURI_INTERNALS__`, so no
 * module mock leaks into other test files. Returns what puts the old globals
 * back, for `afterAll`.
 */
export function fakeTauriPage(invoke: Invoke, extra: Record<string, unknown> = {}) {
  // Plugin scripts fail to load rather than being fetched from nowhere.
  const page = new Window({ settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
  Object.assign(page, {
    __TAURI_INTERNALS__: {
      invoke: async (command: string, args?: Record<string, unknown>) => {
        if (command === "plugin:app|version") return "3.0.0";
        return invoke(command, args);
      },
      convertFileSrc: (path: string, protocol = "asset") =>
        `${protocol}://localhost/${encodeURIComponent(path)}`,
      transformCallback: () => 0,
    },
  });
  const globals: Record<string, unknown> = {
    window: page,
    document: page.document,
    HTMLElement: page.HTMLElement,
    Element: page.Element,
    Event: page.Event,
    CustomEvent: page.CustomEvent,
    ...extra,
  };
  const before = Object.fromEntries(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)])
  );
  Object.assign(globalThis, globals);
  return () => {
    for (const [key, descriptor] of Object.entries(before)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
  };
}
