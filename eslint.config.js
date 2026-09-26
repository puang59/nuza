import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

/**
 * The rules worth having on a codebase this size, and no more.
 *
 * `react-hooks` is the reason this exists: two `eslint-disable-next-line
 * react-hooks/exhaustive-deps` comments were sitting in the tree pointing at a
 * rule nothing enforced, and that rule is what catches a stale closure or a
 * guard that depends on state arriving synchronously.
 */
export default tseslint.config(
  { ignores: ["dist", "src-tauri/target", "node_modules"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      // An unused argument is often there to document a signature - `_view` in
      // a widget's updateDOM, say - so leading-underscore names are allowed.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],

      // New in eslint-plugin-react-hooks v7, and both flag patterns this
      // codebase uses on purpose and documents: refs read during render so a
      // closure captured once can see current state, and state set from an
      // effect to drive an exit animation. They are worth seeing, but making
      // them errors would mean rewriting twenty-odd working call sites to
      // satisfy a rule that arrived after the code did. Warnings for now,
      // tracked separately.
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  // Node scripts, not browser code.
  {
    files: ["scripts/**/*.ts", "*.config.{js,ts}"],
    languageOptions: { globals: globals.node },
  }
);
