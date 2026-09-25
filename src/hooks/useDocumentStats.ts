import { useEffect, useState } from "react";
import { DocumentStats, EMPTY_DOCUMENT_STATS } from "@/lib/documentStats";

export type StatsSubscription = (listener: (stats: DocumentStats) => void) => () => void;

/**
 * The open document's statistics, kept local to whichever footer is showing
 * them. Subscribing rather than taking them as a prop is what stops a keystroke
 * from re-rendering the rest of the app on its way to the word count.
 */
export function useDocumentStats(subscribe: StatsSubscription) {
  const [stats, setStats] = useState<DocumentStats>(EMPTY_DOCUMENT_STATS);
  useEffect(() => subscribe(setStats), [subscribe]);
  return stats;
}
