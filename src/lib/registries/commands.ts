import { KEYMAP_ACTIONS } from "@/lib/keymaps";
import { Registry } from "./registry";

/** The group nuza's own commands are listed under. */
export const CORE_GROUP = "nuza";

/** Something that can be run from a shortcut or the palette. */
export interface CommandSpec {
  /** A built-in action's id, or "<plugin-id>:<command-id>". */
  id: string;
  label: string;
  description?: string;
  defaultBinding?: string;
  /** What Keymaps lists it under: "nuza", or the plugin's name. */
  group: string;
  run(): void | Promise<void>;
  /** False while it has nothing to do: hidden from the palette, and its keys pass through. */
  enabled?(): boolean;
  /** False for a command the palette should not offer, such as opening the palette. */
  inPalette?: boolean;
}

/** Every command this window can run. */
export const commands = new Registry<CommandSpec>();

/** Whether `command` can run right now. */
export function isEnabled(command: CommandSpec): boolean {
  return command.enabled?.() !== false;
}

/**
 * The binding of every command: the user's choice where there is one, else its
 * default. nuza's own actions come first, and are there even before they are
 * registered, so nothing that shows a shortcut ever finds it missing; a
 * command added later follows in the order it was added.
 *
 * Overrides for commands that are not registered - a plugin that is off - are
 * left out here but kept in storage, so its shortcuts are back when it is.
 */
export function resolveBindings(
  registered: readonly CommandSpec[],
  overrides: Partial<Record<string, string>>
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const action of KEYMAP_ACTIONS) map[action.id] = overrides[action.id] ?? action.defaultBinding;
  for (const command of registered) {
    if (command.id in map) continue;
    const binding = overrides[command.id] ?? command.defaultBinding;
    if (binding) map[command.id] = binding;
  }
  return map;
}
