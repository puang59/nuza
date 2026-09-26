/**
 * Sets the version in the three places that have to agree: package.json,
 * src-tauri/tauri.conf.json and src-tauri/Cargo.toml. They had drifted apart
 * once already - Cargo was four releases behind the other two, which is the
 * number the bundle's own metadata is built from.
 *
 *   bun run scripts/bump-version.ts 0.1.14
 */
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("usage: bun run scripts/bump-version.ts <major.minor.patch>");
  process.exit(1);
}

/** Rewrites the first match of `pattern`, and complains if there is not one. */
function edit(path: string, pattern: RegExp, replace: string) {
  const before = readFileSync(path, "utf8");
  const after = before.replace(pattern, replace);
  if (after === before) {
    console.error(`${path}: found no version to change`);
    process.exit(1);
  }
  writeFileSync(path, after);
  console.log(`${path} -> ${version}`);
}

edit("package.json", /("version":\s*")[^"]+(")/, `$1${version}$2`);
edit("src-tauri/tauri.conf.json", /("version":\s*")[^"]+(")/, `$1${version}$2`);
// Only the one under [package]; the dependency versions below it are not ours.
edit("src-tauri/Cargo.toml", /(\[package\][\s\S]*?\nversion = ")[^"]+(")/, `$1${version}$2`);
