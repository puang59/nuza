import { tell } from "@/lib/notices";

/**
 * The pieces of nuza's interface a plugin builds with, drawn in nuza's own
 * look so a plugin's settings and dialogs read as part of the app.
 */

/** A short message at the foot of the window, gone after a few seconds. */
export class Notice {
  constructor(message: string) {
    tell(message);
  }
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement) {
  const el = document.createElement(tag);
  el.className = className;
  parent?.append(el);
  return el;
}

/**
 * A dialog over the window. Fill `contentEl` in `onOpen`; Escape, a click
 * outside, or `close()` shuts it.
 */
export class Modal {
  readonly titleEl: HTMLElement;
  readonly contentEl: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    this.close();
  };

  constructor() {
    this.overlay = element(
      "div",
      "fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fade-in"
    );
    const panel = element(
      "div",
      "bg-[var(--nuza-bg)] border border-zinc-700 rounded-lg shadow-xl w-[480px] max-w-full max-h-full overflow-y-auto p-4 animate-panel-in",
      this.overlay
    );
    panel.setAttribute("role", "dialog");
    panel.addEventListener("click", (event) => event.stopPropagation());
    this.overlay.addEventListener("click", () => this.close());
    this.titleEl = element("h2", "text-base font-semibold text-white mb-3", panel);
    this.contentEl = element("div", "text-sm text-gray-300", panel);
  }

  open() {
    if (this.overlay.isConnected) return;
    document.body.append(this.overlay);
    window.addEventListener("keydown", this.onKey, true);
    this.onOpen();
  }

  close() {
    if (!this.overlay.isConnected) return;
    window.removeEventListener("keydown", this.onKey, true);
    this.overlay.remove();
    this.onClose();
  }

  onOpen() {}
  onClose() {}
}

/** One row of settings, built up: a name and a line under it, and controls on the right. */
export class Setting {
  readonly settingEl: HTMLElement;
  readonly nameEl: HTMLElement;
  readonly descEl: HTMLElement;
  readonly controlEl: HTMLElement;

  constructor(containerEl: HTMLElement) {
    this.settingEl = element("div", "flex items-start justify-between gap-4 py-3", containerEl);
    const info = element("div", "min-w-0", this.settingEl);
    this.nameEl = element("h3", "text-sm font-medium text-white", info);
    this.descEl = element("p", "text-xs text-gray-500 mt-1", info);
    this.controlEl = element("div", "shrink-0 pt-0.5 flex items-center gap-2", this.settingEl);
  }

  setName(name: string) {
    this.nameEl.textContent = name;
    return this;
  }

  setDesc(description: string) {
    this.descEl.textContent = description;
    return this;
  }

  addToggle(
    build: (toggle: { setValue(on: boolean): void; onChange(cb: (on: boolean) => void): void }) => void
  ) {
    const button = element(
      "button",
      "relative h-[18px] w-8 rounded-full transition-colors cursor-pointer bg-zinc-700 aria-checked:bg-[var(--nuza-accent)]",
      this.controlEl
    );
    button.type = "button";
    button.setAttribute("role", "switch");
    const knob = element(
      "span",
      "absolute top-[2px] left-[2px] size-[14px] rounded-full bg-white transition-transform",
      button
    );
    let value = false;
    let listener: ((on: boolean) => void) | null = null;
    const show = () => {
      button.setAttribute("aria-checked", String(value));
      knob.style.transform = value ? "translateX(14px)" : "";
    };
    button.addEventListener("click", () => {
      value = !value;
      show();
      listener?.(value);
    });
    show();
    build({
      setValue(on) {
        value = on;
        show();
      },
      onChange(cb) {
        listener = cb;
      },
    });
    return this;
  }

  addText(
    build: (text: {
      inputEl: HTMLInputElement;
      setValue(value: string): void;
      setPlaceholder(placeholder: string): void;
      onChange(cb: (value: string) => void): void;
    }) => void
  ) {
    const input = element(
      "input",
      "w-48 rounded-md border border-zinc-700 bg-transparent px-2 py-1 text-sm text-white outline-none focus:border-zinc-500",
      this.controlEl
    );
    build({
      inputEl: input,
      setValue: (value) => void (input.value = value),
      setPlaceholder: (placeholder) => void (input.placeholder = placeholder),
      onChange: (cb) => input.addEventListener("input", () => cb(input.value)),
    });
    return this;
  }

  addDropdown(
    build: (dropdown: {
      addOption(value: string, label: string): void;
      setValue(value: string): void;
      onChange(cb: (value: string) => void): void;
    }) => void
  ) {
    const select = element(
      "select",
      "rounded-md border border-zinc-700 bg-[var(--nuza-bg)] px-2 py-1 text-sm text-white outline-none",
      this.controlEl
    );
    build({
      addOption(value, label) {
        const option = element("option", "", select);
        option.value = value;
        option.textContent = label;
      },
      setValue: (value) => void (select.value = value),
      onChange: (cb) => select.addEventListener("change", () => cb(select.value)),
    });
    return this;
  }

  addButton(build: (button: { setButtonText(text: string): void; onClick(cb: () => void): void }) => void) {
    const button = element(
      "button",
      "rounded-md border border-zinc-700 px-3 py-1 text-sm text-white hover:bg-zinc-800 transition-colors cursor-pointer",
      this.controlEl
    );
    button.type = "button";
    build({
      setButtonText: (text) => void (button.textContent = text),
      onClick: (cb) => button.addEventListener("click", cb),
    });
    return this;
  }
}

/** A plugin's pane in Settings. `display` fills `containerEl` each time the pane is opened. */
export abstract class PluginSettingTab {
  containerEl: HTMLElement = document.createElement("div");
  abstract display(): void;
  hide() {}
}

/** Asks a yes-or-no question in a dialog. */
export function confirm(options: { title: string; body?: string; confirm?: string; danger?: boolean }) {
  return new Promise<boolean>((resolve) => {
    let answered = false;
    const modal = new (class extends Modal {
      onOpen() {
        this.titleEl.textContent = options.title;
        if (options.body) element("p", "mb-4 text-gray-400", this.contentEl).textContent = options.body;
        const row = element("div", "flex justify-end gap-2", this.contentEl);
        const cancel = element(
          "button",
          "rounded-md px-3 py-1 text-sm text-gray-400 hover:text-white cursor-pointer",
          row
        );
        cancel.textContent = "Cancel";
        cancel.addEventListener("click", () => this.close());
        const ok = element(
          "button",
          `rounded-md px-3 py-1 text-sm text-white cursor-pointer ${options.danger ? "bg-red-600 hover:bg-red-500" : "bg-zinc-700 hover:bg-zinc-600"}`,
          row
        );
        ok.textContent = options.confirm ?? "OK";
        ok.addEventListener("click", () => {
          answered = true;
          this.close();
        });
        ok.focus();
      }
      onClose() {
        resolve(answered);
      }
    })();
    modal.open();
  });
}

/** Asks for a line of text in a dialog: null if it was dismissed. */
export function prompt(options: { title: string; placeholder?: string; value?: string }) {
  return new Promise<string | null>((resolve) => {
    let answer: string | null = null;
    const modal = new (class extends Modal {
      onOpen() {
        this.titleEl.textContent = options.title;
        const input = element(
          "input",
          "w-full rounded-md border border-zinc-700 bg-transparent px-2 py-1.5 text-sm text-white outline-none focus:border-zinc-500",
          this.contentEl
        );
        input.placeholder = options.placeholder ?? "";
        input.value = options.value ?? "";
        input.addEventListener("keydown", (event) => {
          if (event.key !== "Enter") return;
          answer = input.value;
          this.close();
        });
        input.focus();
      }
      onClose() {
        resolve(answer);
      }
    })();
    modal.open();
  });
}
