import * as autocomplete from "@codemirror/autocomplete";
import * as commands from "@codemirror/commands";
import * as language from "@codemirror/language";
import * as search from "@codemirror/search";
import * as state from "@codemirror/state";
import * as view from "@codemirror/view";
import * as lezerCommon from "@lezer/common";
import * as lezerHighlight from "@lezer/highlight";
import * as lezerMarkdown from "@lezer/markdown";
import * as nuza from "./api";

/**
 * What a plugin's `require` can reach: the API, and nuza's own copies of the
 * libraries a page can only have one of. A second @codemirror/state, bundled
 * into a plugin, makes extensions that the editor does not recognise as
 * extensions - so these are left out of a plugin's bundle and handed over here.
 */
const SHARED: Record<string, unknown> = {
  nuza,
  "@codemirror/autocomplete": autocomplete,
  "@codemirror/commands": commands,
  "@codemirror/language": language,
  "@codemirror/search": search,
  "@codemirror/state": state,
  "@codemirror/view": view,
  "@lezer/common": lezerCommon,
  "@lezer/highlight": lezerHighlight,
  "@lezer/markdown": lezerMarkdown,
};

/** The `require` a plugin's code is given. */
export function requireShared(name: string): unknown {
  if (Object.prototype.hasOwnProperty.call(SHARED, name)) return SHARED[name];
  throw new Error(`Cannot find module "${name}": nuza doesn't share it, so bundle it with your plugin`);
}
