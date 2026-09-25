/**
 * The folders nuza has been pointed at, most recently opened first.
 *
 * A vault is just a directory; the list is a convenience so that opening the
 * one you were working in is a click rather than a trip through the file
 * picker. Nothing here touches disk - forgetting a vault forgets the entry,
 * and renaming one renames the label, not the folder.
 */
export interface Vault {
  /** The folder on disk. This is also the vault's identity in the list. */
  path: string;
  /** What to call it in the switcher: the folder's own name until renamed. */
  name: string;
}

/** The last segment of a path, which is what a folder is normally called. */
export function folderName(path: string) {
  const segments = path.split(/[\\/]+/).filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

/** Whatever came out of storage, reduced to entries that make sense. */
export function readVaults(stored: unknown): Vault[] {
  if (!Array.isArray(stored)) return [];

  const seen = new Set<string>();
  const vaults: Vault[] = [];

  for (const entry of stored) {
    if (!entry || typeof entry !== "object") continue;
    const { path, name } = entry as Partial<Vault>;
    if (typeof path !== "string" || !path || seen.has(path)) continue;

    seen.add(path);
    vaults.push({ path, name: typeof name === "string" && name.trim() ? name : folderName(path) });
  }

  return vaults;
}

/**
 * Moves `path` to the front of the list, adding it if it is new. A vault that
 * has been renamed keeps its label when it is opened again.
 */
export function rememberVault(vaults: Vault[], path: string): Vault[] {
  if (!path) return vaults;
  const known = vaults.find((vault) => vault.path === path);
  return [known ?? { path, name: folderName(path) }, ...vaults.filter((vault) => vault.path !== path)];
}

/** Renames the entry in the list. The folder on disk is left alone. */
export function renameVault(vaults: Vault[], path: string, name: string): Vault[] {
  const label = name.trim();
  if (!label) return vaults;
  return vaults.map((vault) => (vault.path === path ? { ...vault, name: label } : vault));
}

/** Drops the entry from the list, leaving the folder and its notes in place. */
export function forgetVault(vaults: Vault[], path: string): Vault[] {
  return vaults.filter((vault) => vault.path !== path);
}
