/**
 * The `nuza` module a plugin imports: `import { Plugin, Notice } from "nuza"`.
 * Its types are published as @nuza/plugin-api; this is what they describe.
 */
export { Plugin } from "./plugin";
export type { Command, PluginManifest, SidebarViewSpec, CodeBlockRender } from "./plugin";
export { Modal, Notice, PluginSettingTab, Setting } from "./ui";
export type { App, Editor, FileRef, NoteRef } from "./app";

/** The plugin API major this runtime is. */
export const apiVersion = 1;
