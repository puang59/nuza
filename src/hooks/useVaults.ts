import { useCallback, useMemo } from "react";
import { Vault, forgetVault, readVaults, rememberVault, renameVault } from "@/lib/vaults";
import { usePersistedState } from "./usePersistedState";

/** The remembered vaults, and the ways the switcher can change the list. */
export function useVaults() {
  const [stored, setStored] = usePersistedState<Vault[]>("vaults", []);

  // Storage is a file anyone can edit, so what comes back is checked rather
  // than trusted - and memoised, since the list is a prop of a memoised panel.
  const vaults = useMemo(() => readVaults(stored), [stored]);

  const remember = useCallback(
    (path: string) => setStored((list) => rememberVault(readVaults(list), path)),
    [setStored]
  );

  const rename = useCallback(
    (path: string, name: string) => setStored((list) => renameVault(readVaults(list), path, name)),
    [setStored]
  );

  const forget = useCallback(
    (path: string) => setStored((list) => forgetVault(readVaults(list), path)),
    [setStored]
  );

  return { vaults, remember, rename, forget };
}
