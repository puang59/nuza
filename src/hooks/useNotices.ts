import { useCallback, useEffect, useRef, useState } from "react";
import { EXIT_DURATION } from "@/hooks/useExitAnimation";
import { Notice, NOTICE_EVENT } from "@/lib/notices";

/** How long a notice stays up before it takes itself away. */
const HOLD = 6000;

/** How many are shown at once; older ones drop off the top. */
const LIMIT = 3;

/** Collects what the app has to say, for the stack that shows it. */
export function useNotices() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const nextId = useRef(0);
  /** Removals waiting on an exit animation, cleared if the app unmounts first. */
  const leaving = useRef(new Set<ReturnType<typeof setTimeout>>());

  /**
   * Starts a notice on its way out. It is flagged rather than dropped, and
   * only really goes once its exit has had time to run - React unmounts the
   * moment something leaves the list, which is how a toast ends up appearing
   * with an animation and then vanishing without one.
   */
  const dismiss = useCallback((id: number) => {
    let flagged = false;
    setNotices((current) =>
      current.map((notice) => {
        if (notice.id !== id || notice.leaving) return notice;
        flagged = true;
        return { ...notice, leaving: true };
      })
    );

    // Already on its way out: the hold timer and a click can both land here.
    if (!flagged) return;

    const timer = setTimeout(() => {
      leaving.current.delete(timer);
      setNotices((current) => current.filter((notice) => notice.id !== id));
    }, EXIT_DURATION);
    leaving.current.add(timer);
  }, []);

  useEffect(() => {
    function onNotice(event: Event) {
      const { message, reason } = (event as CustomEvent<Omit<Notice, "id">>).detail;

      setNotices((current) => {
        // The same failure twice is one notice. Autosave runs on a timer, so a
        // note that cannot be written would otherwise stack one up every
        // 800ms until the screen was nothing else. One already on its way out
        // does not count - that one is leaving, and this is news again.
        if (
          current.some((notice) => !notice.leaving && notice.message === message && notice.reason === reason)
        ) {
          return current;
        }

        return [...current, { id: nextId.current++, message, reason }].slice(-LIMIT);
      });
    }

    window.addEventListener(NOTICE_EVENT, onNotice);
    return () => window.removeEventListener(NOTICE_EVENT, onNotice);
  }, []);

  useEffect(() => {
    const timers = leaving.current;
    return () => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  return { notices, dismiss, hold: HOLD };
}
