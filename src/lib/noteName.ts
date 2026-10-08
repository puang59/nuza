/**
 * The name for a new note in a folder that already has the `taken` names in
 * it: "Untitled.md", then "Untitled 1.md", "Untitled 2.md" and so on - the
 * first that is free, compared without regard to case, since most of the
 * filesystems a vault lives on do not tell `untitled.md` from `Untitled.md`.
 */
export function untitledName(taken: Iterable<string>, skip = 0): string {
  const used = new Set(Array.from(taken, (name) => name.toLowerCase()));
  let free = 0;
  for (let n = 0; ; n++) {
    const name = n === 0 ? "Untitled.md" : `Untitled ${n}.md`;
    if (used.has(name.toLowerCase())) continue;
    if (free++ === skip) return name;
  }
}
